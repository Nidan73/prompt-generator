/**
 * Admin Authentication — Zero-Dependency Web Crypto JWT
 *
 * Uses native Web Crypto API (HMAC-SHA256) available in Node.js 16+, Next.js,
 * and edge runtimes. No external npm dependencies required.
 */

export const ADMIN_COOKIE_NAME = "btq_admin_token";
const TOKEN_EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecretKey(): string {
  const secret =
    process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_SECRET ||
    process.env.OPENROUTER_API_KEY ||
    process.env.GEMINI_API_KEY;

  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "bhai-thik-kor-dev-secret-key";
  throw new Error("ADMIN_PASSWORD environment variable is not configured.");
}

export function verifyPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET;
  if (expected) {
    return password.trim() === expected.trim();
  }
  // In local development only, allow default fallback if no env var set
  if (process.env.NODE_ENV !== "production") {
    return password.trim() === "admin123";
  }
  return false;
}

/** Base64URL encoder */
function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Base64URL decoder */
function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  return Buffer.from(base64, "base64").toString("utf-8");
}

async function getCryptoKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export type AdminJwtPayload = {
  role: "admin";
  iat: number;
  exp: number;
};

/** Sign a JWT token using HMAC-SHA256 */
export async function createAdminToken(): Promise<string> {
  const secret = getSecretKey();
  const key = await getCryptoKey(secret);

  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminJwtPayload = {
    role: "admin",
    iat: now,
    exp: now + TOKEN_EXPIRY_SECONDS,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const enc = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(dataToSign));
  const encodedSignature = Buffer.from(signatureBuffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${dataToSign}.${encodedSignature}`;
}

/** Verify a JWT token */
export async function verifyAdminToken(token: string): Promise<boolean> {
  if (!token || typeof token !== "string") return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const dataToVerify = `${encodedHeader}.${encodedPayload}`;

  try {
    const payload: AdminJwtPayload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return false;
    if (payload.role !== "admin") return false;

    const secret = getSecretKey();
    const key = await getCryptoKey(secret);

    // Convert signature from base64url to Uint8Array
    let sigBase64 = encodedSignature.replace(/-/g, "+").replace(/_/g, "/");
    while (sigBase64.length % 4) sigBase64 += "=";
    const signatureBytes = new Uint8Array(Buffer.from(sigBase64, "base64"));

    const enc = new TextEncoder();
    return await crypto.subtle.verify("HMAC", key, signatureBytes, enc.encode(dataToVerify));
  } catch {
    return false;
  }
}

/** Check if incoming NextRequest is authorized as Admin */
export async function isAdminAuthorized(request: Request): Promise<boolean> {
  // 1. Check Authorization Bearer header
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (await verifyAdminToken(token)) return true;
  }

  // 2. Check Cookie
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const [k, ...v] = c.trim().split("=");
        return [k, decodeURIComponent(v.join("="))];
      }),
    );
    const token = cookies[ADMIN_COOKIE_NAME];
    if (token && (await verifyAdminToken(token))) return true;
  }

  // 3. Fallback: Direct query param ?key=
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (key && verifyPassword(key)) return true;
  } catch {
    // Ignore URL parse errors
  }

  return false;
}
