import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  isAllowedLinkedInPath,
  isLoopbackAddress,
  isWriteConfirmed,
  normalizePostCount,
} from "./policy.js";

const execFileAsync = promisify(execFile);

const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3190),
  version: process.env.LINKEDIN_VERSION ?? "202606",
  keychainService: process.env.LINKEDIN_KEYCHAIN_SERVICE ?? "linkedin-gpt-connector",
  keychainAccount: process.env.LINKEDIN_KEYCHAIN_ACCOUNT ?? "linkedin-access-token",
  clientId: process.env.LINKEDIN_CLIENT_ID ?? "",
  clientSecretKeychainAccount: process.env.LINKEDIN_CLIENT_SECRET_KEYCHAIN_ACCOUNT ?? "linkedin-client-secret",
  oauthRedirectUri: process.env.LINKEDIN_OAUTH_REDIRECT_URI ?? "http://127.0.0.1:3190/oauth/callback",
  oauthScopes: (process.env.LINKEDIN_OAUTH_SCOPES ?? "openid profile email w_member_social")
    .split(/\s+/)
    .filter(Boolean),
  usePkce: process.env.LINKEDIN_USE_PKCE === "true",
  apiKey: process.env.MCP_API_KEY ?? "",
};

if (config.host !== "127.0.0.1" && config.host !== "::1") {
  throw new Error("Local LinkedIn Agent may only bind to a loopback address");
}

async function loadAccessToken(): Promise<string> {
  if (process.env.LINKEDIN_ACCESS_TOKEN) return process.env.LINKEDIN_ACCESS_TOKEN;
  if (process.platform !== "darwin") {
    throw new Error("LINKEDIN_ACCESS_TOKEN is required outside macOS");
  }
  const { stdout } = await execFileAsync("/usr/bin/security", [
    "find-generic-password",
    "-s", config.keychainService,
    "-a", config.keychainAccount,
    "-w",
  ]);
  const token = stdout.trim();
  if (!token) throw new Error("LinkedIn access token was not found in macOS Keychain");
  return token;
}

async function loadKeychainValue(account: string): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execFileAsync("/usr/bin/security", [
      "find-generic-password",
      "-s", config.keychainService,
      "-a", account,
      "-w",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function saveKeychainValue(account: string, value: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("OAuth token storage requires macOS Keychain");
  }
  await execFileAsync("/usr/bin/security", [
    "add-generic-password",
    "-U",
    "-s", config.keychainService,
    "-a", account,
    "-w", value,
  ]);
}

type PendingOAuth = { verifier?: string; createdAt: number };
const pendingOAuth = new Map<string, PendingOAuth>();

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function oauthAuthorizationUrl(): string {
  if (!config.clientId) throw new Error("LINKEDIN_CLIENT_ID is not configured");
  const state = base64Url(crypto.randomBytes(24));
  const verifier = config.usePkce ? base64Url(crypto.randomBytes(48)) : undefined;
  pendingOAuth.set(state, { verifier, createdAt: Date.now() });
  for (const [key, entry] of pendingOAuth) {
    if (Date.now() - entry.createdAt > 10 * 60 * 1000) pendingOAuth.delete(key);
  }
  const query = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.oauthRedirectUri,
    state,
    scope: config.oauthScopes.join(" "),
  });
  if (verifier) {
    const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
    query.set("code_challenge", challenge);
    query.set("code_challenge_method", "S256");
  }
  return `https://www.linkedin.com/oauth/v2/authorization?${query}`;
}

async function exchangeAuthorizationCode(code: string, verifier?: string) {
  const clientSecret = await loadKeychainValue(config.clientSecretKeychainAccount);
  const baseArgs = [
    "-sS",
    "-X", "POST",
    "https://www.linkedin.com/oauth/v2/accessToken",
    "-H", "Content-Type: application/x-www-form-urlencoded",
    "--data-urlencode", "grant_type=authorization_code",
    "--data-urlencode", `code=${code}`,
    "--data-urlencode", `redirect_uri=${config.oauthRedirectUri}`,
  ];
  if (verifier) baseArgs.push("--data-urlencode", `code_verifier=${verifier}`);

  async function attempt(authMode: "form" | "basic") {
    const args = [...baseArgs];
    if (authMode === "basic" && clientSecret) {
      args.push("--user", `${config.clientId}:${clientSecret}`);
      args.push("--data-urlencode", `client_id=${config.clientId}`);
      args.push("--data-urlencode", `client_secret=${clientSecret}`);
    } else {
      args.push("--data-urlencode", `client_id=${config.clientId}`);
      if (clientSecret) args.push("--data-urlencode", `client_secret=${clientSecret}`);
    }
    args.push("-w", "\\n%{http_code}");
    const { stdout } = await execFileAsync("/usr/bin/curl", args, { maxBuffer: 1024 * 1024 });
    const splitAt = stdout.lastIndexOf("\n");
    const raw = splitAt >= 0 ? stdout.slice(0, splitAt) : stdout;
    const status = splitAt >= 0 ? Number(stdout.slice(splitAt + 1).trim()) : 0;
    let data: Record<string, unknown> = {};
    try { data = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { /* handled below */ }
    return { status, raw, data };
  }

  let result = await attempt("form");
  if (result.status === 401 && result.raw.includes("invalid_client") && clientSecret) {
    result = await attempt("basic");
  }
  if (result.status < 200 || result.status >= 300 || typeof result.data.access_token !== "string") {
    throw new Error(`LinkedIn OAuth token exchange failed (${result.status}): ${result.raw.slice(0, 500)}`);
  }
  await saveKeychainValue(config.keychainAccount, result.data.access_token);
  return { expiresIn: typeof result.data.expires_in === "number" ? result.data.expires_in : null };
}

async function linkedin(pathname: string, init: RequestInit = {}) {
  if (!isAllowedLinkedInPath(pathname)) {
    throw new Error("Only LinkedIn /v2 and /rest API paths are allowed");
  }
  const accessToken = await loadAccessToken();
  const response = await fetch(`https://api.linkedin.com${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "LinkedIn-Version": config.version,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const raw = await response.text();
  let data: unknown = raw;
  try { data = raw ? JSON.parse(raw) : {}; } catch { /* keep text response */ }
  if (!response.ok) {
    const error = new Error(`LinkedIn API ${response.status}`) as Error & { status?: number; details?: unknown };
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return { data, headers: Object.fromEntries(response.headers.entries()) };
}

async function personUrn() {
  try {
    const { data } = await linkedin("/v2/me");
    const id = (data as { id?: string }).id;
    if (id) return `urn:li:person:${id}`;
  } catch { /* OpenID-only applications may not have /v2/me access */ }

  const { data } = await linkedin("/v2/userinfo");
  const id = (data as { sub?: string }).sub;
  if (!id) throw new Error("LinkedIn did not return a member identifier");
  return `urn:li:person:${id}`;
}

function localOnly(req: Request, res: Response, next: NextFunction) {
  const remote = req.socket.remoteAddress ?? "";
  if (!isLoopbackAddress(remote)) {
    res.status(403).json({ error: "Local access only" });
    return;
  }

  if (config.apiKey) {
    const actual = Buffer.from(req.header("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${config.apiKey}`);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }
  next();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };
}

export const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "linkedin-gpt-local-agent", local_only: true });
});

app.use(localOnly);

app.get("/oauth/status", asyncRoute(async (_req, res) => {
  const hasAccessToken = Boolean(await loadKeychainValue(config.keychainAccount));
  const hasClientSecret = Boolean(await loadKeychainValue(config.clientSecretKeychainAccount));
  res.json({
    configured: Boolean(config.clientId),
    authorized: hasAccessToken,
    client_secret_in_keychain: hasClientSecret,
    redirect_uri: config.oauthRedirectUri,
    scopes: config.oauthScopes,
  });
}));

app.get("/oauth/start", (_req, res, next) => {
  try { res.redirect(oauthAuthorizationUrl()); } catch (error) { next(error); }
});

app.get("/oauth/callback", asyncRoute(async (req, res) => {
  const error = typeof req.query.error === "string" ? req.query.error : null;
  if (error) {
    res.status(400).type("html").send(`<h1>LinkedIn authorization was not completed</h1><p>${escapeHtml(error)}</p>`);
    return;
  }
  const code = z.string().min(1).parse(req.query.code);
  const state = z.string().min(1).parse(req.query.state);
  const pending = pendingOAuth.get(state);
  pendingOAuth.delete(state);
  if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
    res.status(400).type("html").send("<h1>OAuth session expired</h1><p>Start authorization again.</p>");
    return;
  }
  const result = await exchangeAuthorizationCode(code, pending.verifier);
  res.type("html").send(`<h1>LinkedIn connected</h1><p>The access token is stored in macOS Keychain.</p><p>Expires in: ${result.expiresIn ?? "not reported"} seconds.</p><p>You may close this tab.</p>`);
}));

app.get("/connection", asyncRoute(async (_req, res) => {
  const { data } = await linkedin("/v2/userinfo");
  const profile = data as { sub?: string; name?: string; email?: string };
  res.json({ connected: true, member_id: profile.sub ?? null, name: profile.name ?? null, email: profile.email ?? null });
}));

app.get("/profile", asyncRoute(async (_req, res) => {
  res.json((await linkedin("/v2/userinfo")).data);
}));

app.get("/posts", asyncRoute(async (req, res) => {
  const count = normalizePostCount(req.query.count);
  const author = await personUrn();
  const query = new URLSearchParams({ q: "author", author, count: String(count) });
  res.json((await linkedin(`/rest/posts?${query}`)).data);
}));

app.post("/posts", asyncRoute(async (req, res) => {
  const input = z.object({ commentary: z.string().min(1).max(3000), confirmed: z.literal(true) }).parse(req.body);
  const author = await personUrn();
  const body = {
    author,
    commentary: input.commentary,
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  const response = await linkedin("/rest/posts", { method: "POST", body: JSON.stringify(body) });
  res.json({ published: true, linkedin_post_id: response.headers["x-restli-id"] ?? null, response: response.data });
}));

app.get("/comments", asyncRoute(async (req, res) => {
  const postUrn = z.string().min(1).parse(req.query.post_urn);
  res.json((await linkedin(`/rest/socialActions/${encodeURIComponent(postUrn)}/comments`)).data);
}));

app.post("/comments", asyncRoute(async (req, res) => {
  const input = z.object({ post_urn: z.string().min(1), message: z.string().min(1).max(1250), confirmed: z.literal(true) }).parse(req.body);
  const actor = await personUrn();
  res.json((await linkedin(`/rest/socialActions/${encodeURIComponent(input.post_urn)}/comments`, {
    method: "POST",
    body: JSON.stringify({ actor, message: { text: input.message } }),
  })).data);
}));

app.get("/analytics/post", asyncRoute(async (req, res) => {
  const postUrn = z.string().min(1).parse(req.query.post_urn);
  const metric = z.enum(["IMPRESSION", "MEMBERS_REACHED", "REACTION", "COMMENT", "RESHARE"]).parse(req.query.metric);
  const query = new URLSearchParams({ q: "entity", entity: postUrn, queryType: metric });
  res.json((await linkedin(`/rest/memberCreatorPostAnalytics?${query}`)).data);
}));

app.get("/analytics/profile", asyncRoute(async (req, res) => {
  const metric = z.enum(["PROFILE_VIEW", "SEARCH_APPEARANCE"]).parse(req.query.metric);
  const query = new URLSearchParams({ q: "me", queryType: metric });
  res.json((await linkedin(`/rest/memberCreatorAnalytics?${query}`)).data);
}));

app.post("/linkedin/request", asyncRoute(async (req, res) => {
  const input = z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    path: z.string().refine(isAllowedLinkedInPath, "Only normalized /v2 and /rest paths are allowed"),
    body: z.unknown().optional(),
    confirmed: z.boolean().optional(),
  }).parse(req.body);
  if (!isWriteConfirmed(input.method, input.confirmed)) {
    res.status(400).json({ error: "confirmed=true is required for write requests" });
    return;
  }
  const response = await linkedin(input.path, {
    method: input.method,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  res.json({ data: response.data, response_headers: response.headers });
}));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid request", details: error.flatten() });
    return;
  }
  const typed = error as Error & { status?: number; details?: unknown };
  res.status(typed.status && typed.status >= 400 && typed.status < 600 ? typed.status : 500).json({
    error: typed.message ?? "Request failed",
    details: typed.details ?? null,
  });
});

export function startServer() {
  return app.listen(config.port, config.host, () => {
    console.log(`LinkedIn GPT Local Agent listening on http://${config.host}:${config.port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
