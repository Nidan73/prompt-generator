import { describe, expect, it } from "vitest";
import {
  createAdminToken,
  verifyAdminToken,
  verifyPassword,
} from "../../lib/admin-auth";

describe("Admin Auth & JWT", () => {
  it("verifies the default password", () => {
    expect(verifyPassword("admin123")).toBe(true);
    expect(verifyPassword("wrongpassword")).toBe(false);
  });

  it("creates and verifies a valid JWT token", async () => {
    const token = await createAdminToken();
    expect(token).toBeDefined();
    expect(token.split(".")).toHaveLength(3);

    const isValid = await verifyAdminToken(token);
    expect(isValid).toBe(true);
  });

  it("rejects an invalid or tampered JWT token", async () => {
    expect(await verifyAdminToken("invalid.jwt.token")).toBe(false);
    expect(await verifyAdminToken("")).toBe(false);

    const token = await createAdminToken();
    const tampered = token.slice(0, -5) + "abcde";
    expect(await verifyAdminToken(tampered)).toBe(false);
  });
});
