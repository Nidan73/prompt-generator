import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminConfigError,
  createAdminToken,
  isAdminAuthorized,
  verifyAdminToken,
  verifyPassword,
} from "../../lib/admin-auth";

const SECRET_A = "A".repeat(40);
const SECRET_B = "B".repeat(40);

beforeEach(() => {
  vi.stubEnv("ADMIN_SESSION_SECRET", SECRET_A);
  vi.stubEnv("ADMIN_PASSWORD", "");
  vi.stubEnv("ADMIN_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Admin Auth & JWT", () => {
  it("rejects every password when none is configured, even outside production", () => {
    expect(verifyPassword("admin123")).toBe(false);
    expect(verifyPassword("")).toBe(false);
  });

  it("verifies against ADMIN_PASSWORD when set", () => {
    vi.stubEnv("ADMIN_PASSWORD", "super-secret-password-xyz");
    expect(verifyPassword("super-secret-password-xyz")).toBe(true);
    expect(verifyPassword("  super-secret-password-xyz  ")).toBe(true);
    expect(verifyPassword("admin123")).toBe(false);
    expect(verifyPassword("super-secret-password-xy")).toBe(false);
  });

  it("accepts the legacy ADMIN_SECRET alias", () => {
    vi.stubEnv("ADMIN_SECRET", "legacy-alias-password");
    expect(verifyPassword("legacy-alias-password")).toBe(true);
  });

  it("creates and verifies a valid JWT token", async () => {
    const token = await createAdminToken();
    expect(token.split(".")).toHaveLength(3);
    expect(await verifyAdminToken(token)).toBe(true);
  });

  it("rejects an invalid or tampered JWT token", async () => {
    expect(await verifyAdminToken("invalid.jwt.token")).toBe(false);
    expect(await verifyAdminToken("")).toBe(false);

    const token = await createAdminToken();
    const tampered = token.slice(0, -5) + "abcde";
    expect(await verifyAdminToken(tampered)).toBe(false);
  });

  it("stops verifying a token once the session secret changes", async () => {
    const token = await createAdminToken();
    expect(await verifyAdminToken(token)).toBe(true);

    vi.stubEnv("ADMIN_SESSION_SECRET", SECRET_B);
    expect(await verifyAdminToken(token)).toBe(false);
  });

  it("does not invalidate a token when the admin password changes", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "first-password");
    const token = await createAdminToken();

    vi.stubEnv("ADMIN_PASSWORD", "second-password");
    expect(await verifyAdminToken(token)).toBe(true);
  });

  it("does not sign with the password or provider keys when the session secret is missing", async () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    vi.stubEnv("ADMIN_PASSWORD", "some-admin-password");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubEnv("GEMINI_API_KEY", "gem-key");

    const token = await createAdminToken();
    vi.stubEnv("ADMIN_PASSWORD", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    // Same dev constant either way: the token survives the other vars vanishing.
    expect(await verifyAdminToken(token)).toBe(true);

    vi.stubEnv("ADMIN_SESSION_SECRET", SECRET_A);
    expect(await verifyAdminToken(token)).toBe(false);
  });

  it("refuses to sign in production without a session secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    await expect(createAdminToken()).rejects.toBeInstanceOf(AdminConfigError);
  });

  it("refuses a session secret shorter than 32 characters in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_SESSION_SECRET", "short-secret");
    await expect(createAdminToken()).rejects.toBeInstanceOf(AdminConfigError);
  });

  it("accepts a 32 character session secret in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_SESSION_SECRET", "x".repeat(32));
    expect(await verifyAdminToken(await createAdminToken())).toBe(true);
  });

  it("treats tokens as invalid, not as errors, when production has no session secret", async () => {
    const token = await createAdminToken();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    expect(await verifyAdminToken(token)).toBe(false);
  });
});

describe("isAdminAuthorized", () => {
  it("does not authorize a bare ?key=<password> request", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "correct-horse-battery");
    const request = new Request("http://localhost/api/admin/usage?key=correct-horse-battery");
    expect(await isAdminAuthorized(request)).toBe(false);
  });

  it("authorizes a valid Bearer token", async () => {
    const token = await createAdminToken();
    const request = new Request("http://localhost/api/admin/usage", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await isAdminAuthorized(request)).toBe(true);
  });

  it("authorizes a valid cookie token", async () => {
    const token = await createAdminToken();
    const request = new Request("http://localhost/api/admin/usage", {
      headers: { cookie: `other=1; btq_admin_token=${token}` },
    });
    expect(await isAdminAuthorized(request)).toBe(true);
  });

  it("does not throw on a malformed percent-encoded cookie", async () => {
    const request = new Request("http://localhost/api/admin/usage", {
      headers: { cookie: "btq_admin_token=%E0%A4%A" },
    });
    await expect(isAdminAuthorized(request)).resolves.toBe(false);
  });

  it("still reads a good cookie that follows a malformed one", async () => {
    const token = await createAdminToken();
    const request = new Request("http://localhost/api/admin/usage", {
      headers: { cookie: `bad=%E0%A4%A; btq_admin_token=${token}` },
    });
    expect(await isAdminAuthorized(request)).toBe(true);
  });
});
