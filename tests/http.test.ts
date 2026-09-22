import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { app } from "../src/local-server.js";

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
