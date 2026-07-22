import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { app } from "../src/local-server.js";

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test server did not expose a TCP address"));
        return;
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
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
