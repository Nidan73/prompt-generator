import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRotatedChain,
  PINNED_POOLS,
  type ProviderConfig,
} from "../../lib/provider-pool";

// In-memory stand-in for Upstash, shared by every module instance in a test.
const fake = vi.hoisted(() => ({
  hashes: new Map<string, Record<string, number>>(),
  values: new Map<string, unknown>(),
  broken: false,
}));

vi.mock("@upstash/redis", () => ({
  Redis: {
    fromEnv() {
      if (fake.broken) throw new Error("no redis env");
      return {
        hgetall: async (key: string) => fake.hashes.get(key) ?? null,
        get: async (key: string) => fake.values.get(key) ?? null,
        hset: async (key: string, fields: Record<string, number>) => {
          fake.hashes.set(key, { ...(fake.hashes.get(key) ?? {}), ...fields });
          return 1;
        },
        hdel: async (key: string, field: string) => {
          const hash = fake.hashes.get(key);
          if (hash) delete hash[field];
          return 1;
        },
        del: async (key: string) => {
          fake.hashes.delete(key);
          fake.values.delete(key);
          return 1;
        },
        set: async (key: string, value: unknown) => {
          fake.values.set(key, value);
          return "OK";
        },
        expire: async () => 1,
      };
    },
  },
}));

function poolOf(names: string[]): ProviderConfig[] {
  return names.map((name) => ({
    name,
    // getRotatedChain only ever reads `name` and `hasKey`.
    sdkModel: null as unknown as ProviderConfig["sdkModel"],
    hasKey: true,
    provider: "groq" as const,
    modelId: name,
  }));
}

describe("pinned pools", () => {
  for (const [poolName, pool] of Object.entries(PINNED_POOLS)) {
    it(`${poolName} entries have a provider and modelId and unique names`, () => {
      for (const entry of pool) {
        expect(entry.provider).toBeTruthy();
        expect(entry.modelId).toBeTruthy();
      }
      const names = pool.map((entry) => entry.name);
      expect(new Set(names).size).toBe(names.length);
    });
  }
});

describe("getRotatedChain", () => {
  it("returns every configured provider exactly once", () => {
    const pool = poolOf(["a", "b", "c"]);
    const chain = getRotatedChain("test-complete", pool);

    expect(chain).toHaveLength(3);
    expect(new Set(chain.map((p) => p.name))).toEqual(new Set(["a", "b", "c"]));
  });

  it("drops providers with no API key", () => {
    const pool = poolOf(["a", "b"]);
    pool[1].hasKey = false;

    expect(getRotatedChain("test-keys", pool).map((p) => p.name)).toEqual(["a"]);
  });

  it("returns an empty chain when nothing is configured", () => {
    const pool = poolOf(["a"]);
    pool[0].hasKey = false;

    expect(getRotatedChain("test-empty", pool)).toEqual([]);
  });

  it("advances the starting provider on each call", () => {
    const pool = poolOf(["a", "b", "c", "d"]);
    const firsts = new Set<string>();

    for (let i = 0; i < 8; i += 1) {
      firsts.add(getRotatedChain("test-advance", pool)[0].name);
    }

    // Eight calls over four providers must touch all four starting points.
    expect(firsts.size).toBe(4);
  });

  it("keeps rotating after the pool shrinks", () => {
    // Chain length varies per request as discovery and cooldowns change it. A
    // counter left over from a larger pool used to exceed the new length, which
    // silently produced an unrotated chain starting at the hot provider again.
    const large = poolOf(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);

    for (let i = 0; i < 9; i += 1) getRotatedChain("test-shrink", large);

    const small = poolOf(["x", "y"]);
    const firsts = new Set<string>();

    for (let i = 0; i < 6; i += 1) {
      const chain = getRotatedChain("test-shrink", small);
      expect(chain).toHaveLength(2);
      firsts.add(chain[0].name);
    }

    expect(firsts).toEqual(new Set(["x", "y"]));
  });

  it("preserves the full chain order so fallback still walks every provider", () => {
    const pool = poolOf(["a", "b", "c"]);

    for (let i = 0; i < 5; i += 1) {
      const chain = getRotatedChain("test-order", pool);
      expect(new Set(chain.map((p) => p.name))).toEqual(new Set(["a", "b", "c"]));
    }
  });
});

describe("shared cooldown status and reset", () => {
  const pool = poolOf(["a", "b"]);

  async function freshPool() {
    vi.resetModules();
    return import("../../lib/provider-pool");
  }

  beforeEach(() => {
    fake.hashes.clear();
    fake.values.clear();
    fake.broken = false;
  });

  it("reports a provider cooled down only in the shared hash", async () => {
    fake.hashes.set("btq:provider-cooldown", { "p:a": Date.now() + 60_000 });
    const mod = await freshPool();

    await mod.syncSharedCooldowns();
    const status = mod.getPoolRuntimeStatus("p", pool);
    const a = status.providers.find((p) => p.name === "a");

    expect(a?.status).toBe("cooling_down");
    expect(a?.coolingDownForMs).toBeGreaterThan(0);
    expect(status.coolingDown).toBe(1);
  });

  it("resetAllCooldowns clears shared and local cooldowns", async () => {
    const mod = await freshPool();
    mod.recordProviderFailure("p", "a");
    mod.recordProviderFailure("p", "a");
    fake.hashes.set("btq:provider-cooldown", { "p:b": Date.now() + 60_000 });
    await mod.syncSharedCooldowns();
    expect(mod.getPoolRuntimeStatus("p", pool).coolingDown).toBe(2);

    await expect(mod.resetAllCooldowns()).resolves.toEqual({ sharedCleared: true });

    expect(mod.getPoolRuntimeStatus("p", pool).coolingDown).toBe(0);
    expect(fake.hashes.has("btq:provider-cooldown")).toBe(false);
    expect(fake.values.get("btq:provider-cooldown-reset-at")).toBeTypeOf("number");
  });

  it("another instance applies the reset on its next sync", async () => {
    const other = await freshPool();
    other.recordProviderFailure("p", "a");
    other.recordProviderFailure("p", "a");
    expect(other.getPoolRuntimeStatus("p", pool).coolingDown).toBe(1);

    // The admin's instance is a separate module copy sharing only Redis.
    vi.resetModules();
    const admin = await import("../../lib/provider-pool");
    await admin.resetAllCooldowns();

    await other.syncSharedCooldowns();
    const status = other.getPoolRuntimeStatus("p", pool);
    expect(status.coolingDown).toBe(0);
    expect(status.providers.find((p) => p.name === "a")?.failures).toBe(0);
  });

  it("still clears local state when Redis is unavailable", async () => {
    fake.broken = true;
    const broken = await freshPool();
    broken.recordProviderFailure("p", "a");
    broken.recordProviderFailure("p", "a");
    expect(broken.getPoolRuntimeStatus("p", pool).coolingDown).toBe(1);

    await expect(broken.resetAllCooldowns()).resolves.toEqual({ sharedCleared: false });
    expect(broken.getPoolRuntimeStatus("p", pool).coolingDown).toBe(0);
  });
});
