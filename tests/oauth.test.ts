import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { after, before, describe, it } from "node:test";
import { buildTokenExchangeRequest, requestAccessToken } from "../src/oauth.js";

const CLIENT_ID = "77test0clientid";
const CLIENT_SECRET = "dummy/secret+value=chars";
const REDIRECT_URI = "http://127.0.0.1:3190/oauth/callback";

type Capture = { headers: Record<string, string | string[] | undefined>; body: string };

let server: Server;
let tokenUrl: string;
let captured: Capture[] = [];
let respond: (req: IncomingMessage, res: ServerResponse, attempt: number) => void;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => { body += chunk; });
    req.on("end", () => {
      captured.push({ headers: req.headers, body });
      respond(req, res, captured.length);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Stub token server did not expose a TCP address"));
        return;
      }
      tokenUrl = `http://127.0.0.1:${address.port}/oauth/v2/accessToken`;
      resolve();
    });
    server.on("error", reject);
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    // fetch() pools keep-alive sockets, and close() waits for every open
    // connection, so without this the suite hangs until the runner times out.
    server.closeAllConnections();
  });
});

function reset(handler: (req: IncomingMessage, res: ServerResponse, attempt: number) => void) {
  captured = [];
  respond = handler;
}

function ok(res: ServerResponse, payload: Record<string, unknown>) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

describe("token exchange request construction", () => {
  const input = {
    code: "auth-code/with+chars=",
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
  };

  // The whole point of the change: a secret in an argv is readable by every other
  // local user through `ps` while the process runs. These assertions pin the
  // secret to the request body and the Authorization header instead.
  it("carries the secret and the code in a form body, not in a command line", () => {
    const { headers, body } = buildTokenExchangeRequest(input, "form");
    assert.equal(headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.equal(headers.Authorization, undefined);

    const parsed = new URLSearchParams(body);
    assert.equal(parsed.get("grant_type"), "authorization_code");
    assert.equal(parsed.get("code"), input.code);
    assert.equal(parsed.get("redirect_uri"), REDIRECT_URI);
    assert.equal(parsed.get("client_id"), CLIENT_ID);
    assert.equal(parsed.get("client_secret"), CLIENT_SECRET);
    assert.equal(parsed.get("code_verifier"), null);
  });

  it("percent-encodes every reserved character in the body", () => {
    const { body } = buildTokenExchangeRequest(input, "form");
    assert.equal(body.includes(CLIENT_SECRET), false, "the raw secret must not appear unencoded");
    assert.equal(body.includes("/"), false);
    assert.match(body, /client_secret=dummy%2Fsecret%2Bvalue%3Dchars/);
  });

  it("sends HTTP basic credentials in the Authorization header in basic mode", () => {
    const { headers, body } = buildTokenExchangeRequest(input, "basic");
    assert.equal(
      headers.Authorization,
      `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, "utf8").toString("base64")}`,
    );
    // Preserved from the curl implementation, which sent both forms on the retry.
    assert.equal(new URLSearchParams(body).get("client_secret"), CLIENT_SECRET);
  });

  it("includes the PKCE verifier only when one was generated", () => {
    const withVerifier = buildTokenExchangeRequest({ ...input, verifier: "pkce-verifier" }, "form");
    assert.equal(new URLSearchParams(withVerifier.body).get("code_verifier"), "pkce-verifier");
  });

  it("omits the client secret entirely for a PKCE-only application", () => {
    const { headers, body } = buildTokenExchangeRequest(
      { ...input, clientSecret: null, verifier: "pkce-verifier" },
      "basic",
    );
    assert.equal(headers.Authorization, undefined, "there is no secret to authenticate with");
    assert.equal(new URLSearchParams(body).has("client_secret"), false);
    assert.equal(new URLSearchParams(body).get("client_id"), CLIENT_ID);
  });
});

describe("token exchange over HTTP", () => {
  const input = {
    code: "auth-code",
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
  };

  it("returns the access token and its lifetime", async () => {
    reset((_req, res) => ok(res, { access_token: "token-value", expires_in: 5184000 }));
    const result = await requestAccessToken(input, tokenUrl);
    assert.deepEqual(result, { accessToken: "token-value", expiresIn: 5184000 });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].headers["content-type"], "application/x-www-form-urlencoded");
    assert.equal(new URLSearchParams(captured[0].body).get("client_secret"), CLIENT_SECRET);
  });

  it("reports a missing expires_in as null rather than guessing", async () => {
    reset((_req, res) => ok(res, { access_token: "token-value" }));
    assert.deepEqual(await requestAccessToken(input, tokenUrl), {
      accessToken: "token-value",
      expiresIn: null,
    });
  });

  it("retries with basic authentication when LinkedIn answers invalid_client", async () => {
    reset((_req, res, attempt) => {
      if (attempt === 1) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_client" }));
        return;
      }
      ok(res, { access_token: "token-after-retry", expires_in: 60 });
    });
    const result = await requestAccessToken(input, tokenUrl);
    assert.equal(result.accessToken, "token-after-retry");
    assert.equal(captured.length, 2);
    assert.equal(captured[0].headers.authorization, undefined);
    assert.equal(
      captured[1].headers.authorization,
      `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, "utf8").toString("base64")}`,
    );
  });

  it("does not retry a 401 that is not invalid_client", async () => {
    reset((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_request" }));
    });
    await assert.rejects(
      requestAccessToken(input, tokenUrl),
      /LinkedIn OAuth token exchange failed \(401\)/,
    );
    assert.equal(captured.length, 1);
  });

  it("does not retry when there is no secret to retry with", async () => {
    reset((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_client" }));
    });
    await assert.rejects(
      requestAccessToken({ ...input, clientSecret: null }, tokenUrl),
      /LinkedIn OAuth token exchange failed \(401\)/,
    );
    assert.equal(captured.length, 1);
  });

  it("fails when a 200 response carries no access token", async () => {
    reset((_req, res) => ok(res, { expires_in: 60 }));
    await assert.rejects(
      requestAccessToken(input, tokenUrl),
      /LinkedIn OAuth token exchange failed \(200\)/,
    );
  });

  it("surfaces the provider error body, truncated", async () => {
    reset((_req, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "x".repeat(900) }));
    });
    await assert.rejects(requestAccessToken(input, tokenUrl), (error: Error) => {
      assert.match(error.message, /LinkedIn OAuth token exchange failed \(400\): /);
      assert.match(error.message, /invalid_grant/);
      assert.equal(error.message.length < 600, true, "the provider body must stay truncated");
      return true;
    });
  });
});
