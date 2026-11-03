import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const check = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rate-limit", () => ({
  createRateLimit: vi.fn(() => ({ check })),
}));

import { POST } from "../../app/api/admin/login/route";
import { POST as logout } from "../../app/api/admin/logout/route";
import { createRateLimit } from "@/lib/rate-limit";
import * as adminAuth from "@/lib/admin-auth";

function allow() {
  return { success: true, limit: 5, remaining: 4, reset: Date.now() + 60_000, degraded: false, scope: "window" };
}

function loginRequest(body: unknown, ip = "203.0.113.9") {
  return new NextRequest("http://localhost/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  check.mockReset();
  check.mockResolvedValue(allow());
  vi.stubEnv("ADMIN_PASSWORD", "correct-horse-battery");
  vi.stubEnv("ADMIN_SESSION_SECRET", "S".repeat(40));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("POST /api/admin/login", () => {
  it("returns success without a token and sets a strict httpOnly cookie", async () => {
    const response = await POST(loginRequest({ password: "correct-horse-battery" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(body).not.toHaveProperty("token");

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("btq_admin_token=");
    expect(cookie).toMatch(/SameSite=strict/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toContain("Max-Age=604800");
  });

  it("rejects a wrong password with 401 and no cookie", async () => {
    const response = await POST(loginRequest({ password: "nope" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid admin password." });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an invalid body with 400", async () => {
    for (const body of [{}, { password: 123 }, { password: "" }, { password: "x".repeat(257) }, "not json"]) {
      const response = await POST(loginRequest(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid admin password." });
    }
  });

  it("rate limits before verifying the password", async () => {
    check.mockResolvedValue({ ...allow(), success: false, remaining: 0, reset: Date.now() + 90_000 });

    const response = await POST(loginRequest({ password: "correct-horse-battery" }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe("Too many login attempts. Try again later.");
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(Number(response.headers.get("retry-after"))).toBe(body.retryAfter);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("denies the 6th attempt in a window of 5", async () => {
    let used = 0;
    check.mockImplementation(async () => {
      used += 1;
      return { ...allow(), success: used <= 5, remaining: Math.max(0, 5 - used) };
    });

    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await POST(loginRequest({ password: "wrong" }))).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("keys the limiter by client identifier", async () => {
    await POST(loginRequest({ password: "wrong" }, "198.51.100.7"));
    expect(check).toHaveBeenCalledWith("198.51.100.7");
  });

  it("configures a 5 per 15 minute window limiter", () => {
    expect(createRateLimit).toHaveBeenCalledWith({
      tokens: 5,
      window: "15 m",
      prefix: "@prompt-generator/admin-login",
      scope: "window",
    });
  });

  it("answers 503 for a wrong password too when production has no session secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_SESSION_SECRET", "");

    const response = await POST(loginRequest({ password: "definitely-wrong" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Admin access is not configured on this deployment.",
    });
  });

  it("fails closed in production when the limiter is degraded, without checking the password", async () => {
    vi.stubEnv("NODE_ENV", "production");
    check.mockResolvedValue({ ...allow(), degraded: true });
    const verify = vi.spyOn(adminAuth, "verifyPassword");

    for (const password of ["correct-horse-battery", "wrong"]) {
      const response = await POST(loginRequest({ password }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Admin login is temporarily unavailable. Try again later.",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it("allows a degraded limiter outside production so local dev works without Upstash", async () => {
    check.mockResolvedValue({ ...allow(), degraded: true });
    const response = await POST(loginRequest({ password: "correct-horse-battery" }));
    expect(response.status).toBe(200);
  });

  it("does not consult the password when the session secret is missing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    const verify = vi.spyOn(adminAuth, "verifyPassword");

    await POST(loginRequest({ password: "correct-horse-battery" }));
    expect(verify).not.toHaveBeenCalled();
  });

  it("answers 503 when production has no session secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_SESSION_SECRET", "");

    const response = await POST(loginRequest({ password: "correct-horse-battery" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Admin access is not configured on this deployment.",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("POST /api/admin/logout", () => {
  it("clears the cookie with the same strict attributes", async () => {
    const response = await logout();
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/SameSite=strict/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toContain("Max-Age=0");
  });
});
