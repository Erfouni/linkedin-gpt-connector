import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { app, keychain } from "../src/local-server.js";

let server: Server;
let baseUrl: string;
let port: number;

// fetch() does not let a caller choose the Host header, which is exactly what a
// DNS-rebinding page controls, so these requests go through node:http instead.
function requestWithHost(host: string, method: string, path: string, body?: unknown) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      method,
      path,
      headers: {
        Host: host,
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      },
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { raw += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

before(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test server did not expose a TCP address"));
        return;
      }
      port = address.port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
    server.on("error", reject);
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe("HTTP security contract", () => {
  it("serves a no-store health response without implementation headers", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.has("x-powered-by"), false);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: "linkedin-gpt-local-agent",
      local_only: true,
    });
  });

  it("rejects a normalized path escape before any LinkedIn request", async () => {
    const response = await fetch(`${baseUrl}/linkedin/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "GET", path: "/v2/../oauth/v2/accessToken" }),
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error?: string };
    assert.equal(body.error, "Invalid request");
  });

  it("rejects an unconfirmed write before loading credentials", async () => {
    const response = await fetch(`${baseUrl}/linkedin/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "POST", path: "/rest/posts", body: { commentary: "test" } }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "confirmed=true is required for write requests" });
  });
});

describe("DNS-rebinding boundary", () => {
  // A page on rebind.example that re-resolves its own name to 127.0.0.1 reaches
  // this server from a loopback socket, but its browser still sends
  // "Host: rebind.example:<port>". The socket check alone cannot tell them apart.
  const unconfirmedWrite = { method: "POST", path: "/rest/posts", body: { commentary: "test" } };

  it("rejects a request addressed to a non-loopback host name", async () => {
    for (const host of [`rebind.example:${port}`, `127.0.0.1.rebind.example:${port}`, `localhost.rebind.example`]) {
      const response = await requestWithHost(host, "POST", "/linkedin/request", unconfirmedWrite);
      assert.equal(response.status, 403, host);
      assert.deepEqual(response.body, { error: "Host must be 127.0.0.1, localhost or [::1]" }, host);
    }
  });

  it("rejects a rebound read of the OAuth state", async () => {
    const response = await requestWithHost(`rebind.example:${port}`, "GET", "/oauth/status");
    assert.equal(response.status, 403);
  });

  it("still serves clients that address the agent by a loopback name", async () => {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `LOCALHOST:${port}`]) {
      const response = await requestWithHost(host, "POST", "/linkedin/request", unconfirmedWrite);
      assert.equal(response.status, 400, host);
      assert.deepEqual(response.body, { error: "confirmed=true is required for write requests" }, host);
    }
  });
});

describe("request validation compatibility", () => {
  // Exercise the route schemas, not copies of them. Every non-loopback fetch is
  // intercepted so accepted requests never use LinkedIn or real credentials.
  async function withLinkedInStub(run: (calls: { path: string; init: RequestInit }[]) => Promise<void>) {
    const calls: { path: string; init: RequestInit }[] = [];
    const localFetch = globalThis.fetch;
    process.env.LINKEDIN_ACCESS_TOKEN = "test-only-validation-token";
    const stub = mock.method(globalThis, "fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.origin === baseUrl) return localFetch(input, init);
      assert.equal(url.origin, "https://api.linkedin.com");
      calls.push({ path: url.pathname, init });
      return new Response(JSON.stringify(url.pathname === "/v2/me" ? { id: "test-member" } : { ok: true }), {
        headers: { "Content-Type": "application/json", "x-restli-id": "test-post" },
      });
    });
    try { await run(calls); } finally {
      stub.mock.restore();
      delete process.env.LINKEDIN_ACCESS_TOKEN;
    }
  }

  async function post(path: string, body: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects missing, wrong-type, and out-of-range write fields without contacting LinkedIn", async () => {
    await withLinkedInStub(async (calls) => {
      for (const [path, body, field] of [
        ["/posts", {}, "commentary"],
        ["/posts", { commentary: "", confirmed: true }, "commentary"],
        ["/posts", { commentary: "x".repeat(3001), confirmed: true }, "commentary"],
        ["/posts", { commentary: "text", confirmed: "true" }, "confirmed"],
        ["/comments", { post_urn: "urn:li:share:test", message: 42, confirmed: true }, "message"],
        ["/comments", { post_urn: "urn:li:share:test", message: "x".repeat(1251), confirmed: true }, "message"],
        ["/comments", { post_urn: "", message: "text", confirmed: true }, "post_urn"],
      ] as const) {
        const response = await post(path, body);
        assert.equal(response.status, 400);
        const result = await response.json() as { error: string; details: { formErrors: string[]; fieldErrors: Record<string, string[]> } };
        assert.equal(result.error, "Invalid request");
        assert.deepEqual(result.details.formErrors, []);
        assert.ok(result.details.fieldErrors[field]?.length, `${path}: ${field}`);
      }
      assert.equal(calls.length, 0);
    });
  });

  it("accepts write limits and strips unknown fields from the upstream payload", async () => {
    await withLinkedInStub(async (calls) => {
      const commentary = "x".repeat(3000);
      const postResponse = await post("/posts", { commentary, confirmed: true, extra: "discard" });
      assert.equal(postResponse.status, 200);
      assert.deepEqual(await postResponse.json(), { published: true, linkedin_post_id: "test-post", response: { ok: true } });
      const postBody = JSON.parse(String(calls[1].init.body));
      assert.equal(postBody.commentary, commentary);
      assert.equal(postBody.author, "urn:li:person:test-member");
      assert.equal("extra" in postBody, false);

      const message = "x".repeat(1250);
      const commentResponse = await post("/comments", { post_urn: "urn:li:share:test", message, confirmed: true });
      assert.equal(commentResponse.status, 200);
      assert.deepEqual(JSON.parse(String(calls[3].init.body)), { actor: "urn:li:person:test-member", message: { text: message } });
    });
  });

  it("defaults a generic request to GET with no body or write confirmation", async () => {
    await withLinkedInStub(async (calls) => {
      const response = await post("/linkedin/request", { path: "/v2/userinfo", extra: "discard" });
      assert.equal(response.status, 200);
      const result = await response.json() as { data: unknown; response_headers: Record<string, string> };
      assert.deepEqual(result.data, { ok: true });
      assert.equal(result.response_headers["x-restli-id"], "test-post");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].init.method, "GET");
      assert.equal(calls[0].init.body, undefined);
    });
  });

  it("rejects invalid methods, confirmation types, and non-object request bodies", async () => {
    await withLinkedInStub(async (calls) => {
      for (const body of [null, [], { method: "TRACE", path: "/v2/me" }, { path: "/v2/me", confirmed: "true" }]) {
        const response = await post("/linkedin/request", body);
        assert.equal(response.status, 400);
      }
      assert.equal(calls.length, 0);
    });
  });

  it("rejects missing or repeated query strings and unsupported analytics metrics", async () => {
    await withLinkedInStub(async (calls) => {
      for (const path of ["/comments", "/comments?post_urn=a&post_urn=b", "/analytics/profile?metric=UNKNOWN", "/analytics/post?post_urn=test&metric=UNKNOWN", "/oauth/callback?code=&state=test"]) {
        const response = await fetch(`${baseUrl}${path}`);
        assert.equal(response.status, 400, path);
        assert.equal((await response.json() as { error: string }).error, "Invalid request", path);
      }
      assert.equal(calls.length, 0);
    });
  });
});

describe("OAuth status describes the credential the client will use", () => {
  const originalRead = keychain.read;
  const originalToken = process.env.LINKEDIN_ACCESS_TOKEN;

  afterEach(() => {
    keychain.read = originalRead;
    if (originalToken === undefined) delete process.env.LINKEDIN_ACCESS_TOKEN;
    else process.env.LINKEDIN_ACCESS_TOKEN = originalToken;
  });

  async function status() {
    const response = await fetch(`${baseUrl}/oauth/status`);
    assert.equal(response.status, 200);
    return (await response.json()) as Record<string, unknown>;
  }

  it("reports an environment token without exposing it", async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "fixture-environment-token";
    keychain.read = async () => null;

    const body = await status();
    assert.equal(body.authorized, true);
    assert.equal(body.credential_source, "environment");
    assert.equal(body.access_token_in_keychain, false);
    assert.equal(JSON.stringify(body).includes("fixture-environment-token"), false);
  });

  it("reports a Keychain token when the environment has none", async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    keychain.read = async (account: string) =>
      account.includes("secret") ? null : "fixture-keychain-token";

    const body = await status();
    assert.equal(body.authorized, true);
    assert.equal(body.credential_source, "keychain");
    assert.equal(body.access_token_in_keychain, true);
    assert.equal(body.client_secret_in_keychain, false);
    assert.equal(JSON.stringify(body).includes("fixture-keychain-token"), false);
  });

  it("reports no credential when neither source has one", async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    keychain.read = async () => null;

    const body = await status();
    assert.equal(body.authorized, false);
    assert.equal(body.credential_source, null);
    assert.equal(body.access_token_in_keychain, false);
  });
});
