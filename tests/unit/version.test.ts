import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "../../lib/version";

describe("APP_VERSION", () => {
  it("matches package.json", () => {
    // The footer once read v1.0.0 while package.json said 0.1.0. Keeping the two
    // in step is the kind of thing nobody remembers, so CI remembers instead.
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("is a plain semver triple", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
