import { describe, expect, it } from "vitest";
import robots from "../../app/robots";

describe("robots", () => {
  it("disallows api and admin", () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallow = ([] as string[]).concat(rule.disallow ?? []);
    expect(disallow).toContain("/api/");
    expect(disallow).toContain("/admin");
  });
});
