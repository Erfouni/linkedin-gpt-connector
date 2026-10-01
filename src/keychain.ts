import { spawn } from "node:child_process";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

export type SecurityRunner = (file: string, args: string[], input: string) => Promise<void>;

// `security -i` reads each command into a 4096-byte buffer and runs whatever
// does not fit as the next command, so a line, newline included, must fit.
const MAX_LINE_BYTES = 4095;

// Stores a generic password without putting it on a command line. As an
// argument (`-w <value>`) it is readable by every local user through `ps` for
// as long as security runs; `security -i` takes the same command on stdin.
export async function writeKeychainValue(
  service: string,
  account: string,
  value: string,
  options: { keychain?: string; run?: SecurityRunner } = {},
): Promise<void> {
  const args = ["add-generic-password", "-U", "-s", service, "-a", account, "-w", value];
  if (options.keychain) args.push(options.keychain);
  const line = `${args.map(quoteSecurityArg).join(" ")}\n`;
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
    throw new Error("Keychain value is too long");
  }
  await (options.run ?? runWithInput)("/usr/bin/security", ["-i"], line);
}

// The line parser of `security -i` (split_line in Apple's security.c) takes
// double-quoted arguments with a backslash escaping the next character. A line
// break would end the command early and start another one, so it is refused.
export function quoteSecurityArg(arg: string): string {
  if (/[\0\r\n]/.test(arg)) {
    throw new Error("Keychain fields cannot contain line breaks");
  }
  return `"${arg.replace(/["\\]/g, "\\$&")}"`;
}

// Runs file with input on stdin; a non-zero exit rejects with its stderr.
// `security -i` exits with the status of the last command, as it does when the
// command is given as arguments.
export function runWithInput(file: string, args: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${basename(file)} exited with ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(input);
  });
}

// scripts/install-macos.sh stores the Client Secret through this, with the
// secret on stdin: printf '%s' "$secret" | node dist/keychain.js <service> <account>
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [service, account, keychain] = process.argv.slice(2);
  if (!service || !account) {
    console.error("Usage: node dist/keychain.js <service> <account> [keychain] < value");
    process.exit(2);
  }
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  await writeKeychainValue(service, account, value, { keychain });
}
