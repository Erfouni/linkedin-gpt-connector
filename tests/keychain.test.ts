import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runWithInput, writeKeychainValue, type SecurityRunner } from "../src/keychain.js";

const execFileAsync = promisify(execFile);

// Quotes, a backslash, a shell variable and spaces: everything the security
// line parser or a shell could take apart.
const VALUE = `tok"en\\with 'quotes' $HOME and spaces`;

function recordingRunner() {
  const calls: { file: string; args: string[]; input: string }[] = [];
  const run: SecurityRunner = async (file, args, input) => {
    calls.push({ file, args, input });
  };
  return { calls, run };
}

describe("writeKeychainValue", () => {
  it("hands the value to security on stdin, never as an argument", async () => {
    const { calls, run } = recordingRunner();
    await writeKeychainValue("svc", "acct", VALUE, { run });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, "/usr/bin/security");
    assert.deepEqual(calls[0].args, ["-i"]);
    assert.equal(
      calls[0].input,
      `"add-generic-password" "-U" "-s" "svc" "-a" "acct" "-w" "tok\\"en\\\\with 'quotes' $HOME and spaces"\n`,
    );
  });

  it("names the keychain last when one is given", async () => {
    const { calls, run } = recordingRunner();
    await writeKeychainValue("svc", "acct", "v", { keychain: "/tmp/test.keychain-db", run });
    assert.match(calls[0].input, / "-w" "v" "\/tmp\/test\.keychain-db"\n$/);
  });

  it("refuses a line break, which would start a second security command", async () => {
    for (const value of ["one\ndelete-keychain login.keychain", "one\rtwo", "one\0two"]) {
      const { calls, run } = recordingRunner();
      await assert.rejects(writeKeychainValue("svc", "acct", value, { run }), /line breaks/);
      assert.equal(calls.length, 0);
    }
  });

  it("refuses a value too long for one security -i line", async () => {
    const { calls, run } = recordingRunner();
    await assert.rejects(writeKeychainValue("svc", "acct", "x".repeat(4096), { run }), /too long/);
    assert.equal(calls.length, 0);
  });
});

describe("runWithInput", () => {
  // A child that reads all of stdin before it exits, as security -i does.
  const child = (body: string) => [
    "-e",
    `let s = ""; process.stdin.on("data", (d) => { s += d; }).on("end", () => { ${body} });`,
  ];

  it("delivers the input on stdin and resolves on a zero exit", async () => {
    await runWithInput(process.execPath, child(`process.exit(s === "line one\\n" ? 0 : 1);`), "line one\n");
  });

  it("rejects with the exit status and stderr of a failed run", async () => {
    await assert.rejects(
      runWithInput(process.execPath, child(`console.error("no such item"); process.exit(45);`), "x\n"),
      /exited with 45: no such item/,
    );
  });
});

// Always an existing keychain: for a path that does not exist, security writes
// to the default keychain instead of failing.
describe("writeKeychainValue with the real security tool", { skip: process.platform !== "darwin" && "needs macOS" }, () => {
  let dir: string;
  let keychain: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "linkedin-keychain-"));
    keychain = join(dir, "test.keychain-db");
    await execFileAsync("/usr/bin/security", ["create-keychain", "-p", "test-only", keychain]);
    await execFileAsync("/usr/bin/security", ["unlock-keychain", "-p", "test-only", keychain]);
  });

  after(async () => {
    await execFileAsync("/usr/bin/security", ["delete-keychain", keychain]).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  async function stored(account: string): Promise<string> {
    const { stdout } = await execFileAsync("/usr/bin/security", [
      "find-generic-password", "-s", "svc", "-a", account, "-w", keychain,
    ]);
    return stdout.replace(/\n$/, "");
  }

  it("stores the exact value and replaces it on the next write", async () => {
    await writeKeychainValue("svc", "acct", VALUE, { keychain });
    assert.equal(await stored("acct"), VALUE);
    await writeKeychainValue("svc", "acct", "second", { keychain });
    assert.equal(await stored("acct"), "second");
  });

  it("stores what the installer pipes into node dist/keychain.js", async () => {
    const script = fileURLToPath(new URL("../src/keychain.js", import.meta.url));
    await runWithInput(process.execPath, [script, "svc", "installer", keychain], VALUE);
    assert.equal(await stored("installer"), VALUE);
  });
});
