import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "../../lib/security-headers";

const get = (isDev: boolean, key: string) =>
  buildSecurityHeaders({ isDev }).find((h) => h.key === key)?.value ?? "";

describe("buildSecurityHeaders", () => {
  it("emits all five headers", () => {
    const keys = buildSecurityHeaders({ isDev: false }).map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "Content-Security-Policy",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "X-Frame-Options",
        "Permissions-Policy",
      ]),
    );
    expect(keys).toHaveLength(5);
  });

  it("production CSP is strict", () => {
    const csp = get(false, "Content-Security-Policy");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("ws:");
  });

  it("development CSP allows eval and websockets, not upgrade", () => {
    const csp = get(true, "Content-Security-Policy");
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws:");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("sets the static header values", () => {
    expect(get(false, "X-Content-Type-Options")).toBe("nosniff");
    expect(get(false, "X-Frame-Options")).toBe("DENY");
    expect(get(false, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(get(false, "Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    );
  });
});
