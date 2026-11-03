/**
 * Admin Authentication: zero-dependency HS256 JWT on Web Crypto.
 *
 * Sessions are signed with ADMIN_SESSION_SECRET only. Requests authenticate
 * with a Bearer token or the httpOnly cookie; passwords never travel in a URL.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE_NAME = "btq_admin_token";
const TOKEN_EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days
const MIN_SESSION_SECRET_LENGTH = 32;
const DEV_SESSION_SECRET = "bhai-thik-kor-dev-session-secret-not-for-production";

/** Thrown when the deployment lacks a usable admin session secret. */
export class AdminConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminConfigError";
  }
}

/**
 * The session key is its own secret on purpose: signing with the password or a
 * provider API key would let a leaked or rotated key forge or kill admin
 * sessions, and would tie session lifetime to credentials used elsewhere.
 */
function getSecretKey(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;

  if (process.env.NODE_ENV === "production") {
    if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH) {
      throw new AdminConfigError(
        `ADMIN_SESSION_SECRET must be set to at least ${MIN_SESSION_SECRET_LENGTH} characters.`,
      );
    }
    return secret;
  }

  return secret || DEV_SESSION_SECRET;
}

/** Throws AdminConfigError when sessions cannot be signed on this deployment. */
export function assertAdminConfigured(): void {
  getSecretKey();
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function verifyPassword(password: string): boolean {
  // ADMIN_SECRET is a legacy alias for ADMIN_PASSWORD, kept so old deployments still log in.
  const expected = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET;
  if (!expected || typeof password !== "string") return false;

  // Digesting first gives equal-length buffers, so timingSafeEqual cannot throw
  // and the comparison time does not depend on where the inputs differ.
  return timingSafeEqual(sha256(password.trim()), sha256(expected.trim()));
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
    if (typeof payload.exp !== "number" || payload.exp < now) return false;
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
    const token = readCookie(cookieHeader, ADMIN_COOKIE_NAME);
    if (token && (await verifyAdminToken(token))) return true;
  }

  return false;
}

/** Cookie values are attacker-controlled; a bad escape must skip the value, not throw. */
function readCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      continue;
    }
  }
  return undefined;
}
