const LINKEDIN_API_ORIGIN = "https://api.linkedin.com";
const LINKEDIN_API_PREFIXES = ["/v2/", "/rest/"] as const;

export function isLoopbackAddress(address: string): boolean {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}

export function isAllowedLinkedInPath(value: string): boolean {
  if (!LINKEDIN_API_PREFIXES.some((prefix) => value.startsWith(prefix))) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (/%2f|%5c/i.test(value)) return false;

  try {
    const normalized = new URL(value, LINKEDIN_API_ORIGIN);
    return normalized.origin === LINKEDIN_API_ORIGIN
      && normalized.hash === ""
      && LINKEDIN_API_PREFIXES.some((prefix) => normalized.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

export function normalizePostCount(value: unknown, fallback = 20): number {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return fallback;
  return Math.min(100, Math.max(1, parsed));
}

export function isWriteConfirmed(method: string, confirmed: unknown): boolean {
  return method.toUpperCase() === "GET" || confirmed === true;
}
