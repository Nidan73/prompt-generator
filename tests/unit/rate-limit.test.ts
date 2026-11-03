import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimits, isRateLimitStoreConfigured, type LimitDecision, type RateLimitHandle } from "../../lib/rate-limit";

function decision(overrides: Partial<LimitDecision>): LimitDecision {
  return {
    success: true,
    limit: 10,
    remaining: 5,
    reset: 1000,
    degraded: false,
    scope: "minute",
    ...overrides,
  };
}

function handle(result: LimitDecision) {
  const check = vi.fn(async () => result);
  return { check } satisfies RateLimitHandle;
}

describe("checkRateLimits", () => {
  it("stops at the first failure without consuming later handles", async () => {
    const first = handle(decision({ success: false, remaining: 0, scope: "minute" }));
    const second = handle(decision({ scope: "day" }));

    const result = await checkRateLimits("1.2.3.4", [first, second]);

    expect(result.success).toBe(false);
    expect(result.scope).toBe("minute");
    expect(first.check).toHaveBeenCalledWith("1.2.3.4");
    expect(second.check).not.toHaveBeenCalled();
  });

  it("returns the decision with the lowest remaining when all pass", async () => {
    const minute = handle(decision({ remaining: 4, scope: "minute" }));
    const day = handle(decision({ remaining: 2, scope: "day" }));

    const result = await checkRateLimits("1.2.3.4", [minute, day]);

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.scope).toBe("day");
  });

  it("carries scope from a failing later handle", async () => {
    const minute = handle(decision({ remaining: 4 }));
    const day = handle(decision({ success: false, remaining: 0, scope: "day" }));

    const result = await checkRateLimits("x", [minute, day]);

    expect(result.success).toBe(false);
    expect(result.scope).toBe("day");
  });
});

describe("isRateLimitStoreConfigured", () => {
  const names = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));

  afterEach(() => {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  });

  it("matches the shared env helper, KV names included", () => {
    for (const n of names) process.env[n] = "";
    expect(isRateLimitStoreConfigured()).toBe(false);
    process.env.KV_REST_API_URL = "https://k.upstash.io";
    expect(isRateLimitStoreConfigured()).toBe(false);
    process.env.KV_REST_API_TOKEN = "t";
    expect(isRateLimitStoreConfigured()).toBe(true);
  });
});
