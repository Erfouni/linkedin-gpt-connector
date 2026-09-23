// LinkedIn's OAuth token endpoint. The service never passes another URL; the
// parameter exists so the tests can point the exchange at a local stub.
export const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

export type TokenExchangeInput = {
  code: string;
  clientId: string;
  redirectUri: string;
  clientSecret?: string | null;
  verifier?: string;
};

export type TokenExchangeRequest = {
  headers: Record<string, string>;
  body: string;
};

export type AccessTokenResult = {
  accessToken: string;
  expiresIn: number | null;
};

// The client secret and the authorization code travel in the request body, or in
// an Authorization header — never in a process argument, where any other local
// user could read them out of `ps` for as long as the request runs.
export function buildTokenExchangeRequest(
  input: TokenExchangeInput,
  authMode: "form" | "basic",
): TokenExchangeRequest {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  if (input.verifier) body.set("code_verifier", input.verifier);
  body.set("client_id", input.clientId);
  if (input.clientSecret) body.set("client_secret", input.clientSecret);

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (authMode === "basic" && input.clientSecret) {
    const credentials = Buffer.from(`${input.clientId}:${input.clientSecret}`, "utf8");
    headers.Authorization = `Basic ${credentials.toString("base64")}`;
  }

  return { headers, body: body.toString() };
}

async function attempt(input: TokenExchangeInput, authMode: "form" | "basic", tokenUrl: string) {
  const { headers, body } = buildTokenExchangeRequest(input, authMode);
  const response = await fetch(tokenUrl, { method: "POST", headers, body });
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try { data = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { /* handled by the caller */ }
  return { status: response.status, raw, data };
}

export async function requestAccessToken(
  input: TokenExchangeInput,
  tokenUrl: string = LINKEDIN_TOKEN_URL,
): Promise<AccessTokenResult> {
  let result = await attempt(input, "form", tokenUrl);
  // Some LinkedIn applications reject the secret in the body and want HTTP basic.
  if (result.status === 401 && result.raw.includes("invalid_client") && input.clientSecret) {
    result = await attempt(input, "basic", tokenUrl);
  }
  if (result.status < 200 || result.status >= 300 || typeof result.data.access_token !== "string") {
    throw new Error(`LinkedIn OAuth token exchange failed (${result.status}): ${result.raw.slice(0, 500)}`);
  }
  return {
    accessToken: result.data.access_token,
    expiresIn: typeof result.data.expires_in === "number" ? result.data.expires_in : null,
  };
}
