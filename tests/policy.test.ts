import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAllowedLinkedInPath,
  isLoopbackAddress,
  isLoopbackHost,
  isWriteConfirmed,
  normalizePostCount,
} from "../src/policy.js";

describe("loopback boundary", () => {
  it("accepts the IPv4 and IPv6 addresses emitted by local sockets", () => {
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      assert.equal(isLoopbackAddress(address), true);
    }
  });

  it("rejects non-loopback and missing addresses", () => {
    for (const address of ["", "0.0.0.0", "192.168.1.10", "::ffff:192.168.1.10"]) {
      assert.equal(isLoopbackAddress(address), false);
    }
  });
});

describe("Host header boundary", () => {
  it("accepts loopback names with or without a port, in any letter case", () => {
    for (const host of ["127.0.0.1:3190", "127.0.0.1", "localhost:3190", "LocalHost", "[::1]:3190", "[::1]"]) {
      assert.equal(isLoopbackHost(host), true, host);
    }
  });

  it("rejects other names, look-alikes, userinfo tricks, and a missing header", () => {
    for (const host of [
      undefined,
      "",
      "rebind.example:3190",
      "127.0.0.1.rebind.example",
      "localhost.rebind.example:3190",
      "rebind.example@127.0.0.1",
      "127.0.0.1:3190/",
      "127.0.0.1:",
      "127.0.0.1:99999",
      "::1",
      "[::ffff:127.0.0.1]:3190",
      "0.0.0.0:3190",
    ]) {
      assert.equal(isLoopbackHost(host), false, String(host));
    }
  });
});

describe("LinkedIn path boundary", () => {
  it("accepts normalized v2 and rest API paths", () => {
    assert.equal(isAllowedLinkedInPath("/v2/userinfo"), true);
    assert.equal(isAllowedLinkedInPath("/rest/posts?q=author&count=20"), true);
  });

  it("rejects other origins, unsupported roots, fragments, and control characters", () => {
    for (const path of [
      "https://example.com/v2/userinfo",
      "//example.com/v2/userinfo",
      "/oauth/v2/accessToken",
      "/v2/userinfo#token",
      "/rest/posts\nX-Test: injected",
    ]) {
      assert.equal(isAllowedLinkedInPath(path), false, path);
    }
  });

  it("rejects raw and encoded traversal or separators", () => {
    for (const path of [
      "/v2/../oauth/v2/accessToken",
      "/v2/%2e%2e/oauth/v2/accessToken",
      "/rest/%2Fadmin",
      "/rest/%5cadmin",
    ]) {
      assert.equal(isAllowedLinkedInPath(path), false, path);
    }
  });
});

describe("request normalization", () => {
  it("clamps integer post counts to LinkedIn's supported range", () => {
    assert.equal(normalizePostCount("0"), 1);
    assert.equal(normalizePostCount("42"), 42);
    assert.equal(normalizePostCount("101"), 100);
  });

  it("uses the fallback for absent, fractional, or non-numeric counts", () => {
    assert.equal(normalizePostCount(undefined), 20);
    assert.equal(normalizePostCount("2.5"), 20);
    assert.equal(normalizePostCount("not-a-number"), 20);
    assert.equal(normalizePostCount(["12"]), 20);
  });

  it("requires exact confirmation for every write method", () => {
    assert.equal(isWriteConfirmed("GET", false), true);
    assert.equal(isWriteConfirmed("POST", true), true);
    assert.equal(isWriteConfirmed("PATCH", "true"), false);
    assert.equal(isWriteConfirmed("DELETE", false), false);
  });
});
