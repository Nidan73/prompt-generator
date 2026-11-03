import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// The redis module is mocked below, so these fake values never reach a server.
vi.hoisted(() => {
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
});

vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor() {
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
    }
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

describe("getRotatedChain primaryCount", () => {
  it("always leads with a primary and keeps the later entries after them", () => {
    const pool = poolOf(["P1", "P2", "P3", "L1", "L2"]);
    const firsts = new Set<string>();

    for (let i = 0; i < 12; i += 1) {
      const names = getRotatedChain("test-primary", pool, 3).map((p) => p.name);
      firsts.add(names[0]);
      expect(["P1", "P2", "P3"]).toContain(names[0]);
      expect(names.slice(3)).toEqual(["L1", "L2"]);
    }
    expect(firsts).toEqual(new Set(["P1", "P2", "P3"]));
  });

  it("defaults to rotating the whole pool", () => {
    const pool = poolOf(["a", "b", "c"]);
    const firsts = new Set<string>();
    for (let i = 0; i < 6; i += 1) firsts.add(getRotatedChain("test-default", pool)[0].name);
    expect(firsts.size).toBe(3);
  });
});

describe("generate pool primaries", () => {
  it("rotates only the first three entries and exports the count", async () => {
    const mod = await import("../../lib/provider-pool");
    expect(mod.GENERATE_PRIMARY_COUNT).toBe(3);
    expect(mod.GENERATE_POOL.slice(0, 3).map((p) => p.name)).toEqual([
      "Groq GPT-OSS 120B",
      "Groq GPT-OSS 20B",
      "Gemini 3.6 Flash",
    ]);
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

describe("getChain ordering and availability", () => {
  const catalogue = [{ id: "or/x:free" }, { id: "or/y:free" }];

  function entry(name: string, provider: ProviderConfig["provider"] = "groq"): ProviderConfig {
    return {
      name,
      sdkModel: null as unknown as ProviderConfig["sdkModel"],
      hasKey: true,
      provider,
      modelId: name,
    };
  }

  async function setup() {
    vi.resetModules();
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubEnv("GROQ_API_KEY", "g-key");
    vi.doMock("../../lib/openrouter-free", () => ({
      peekFreeModels: () => catalogue,
      getFreeModels: async () => catalogue,
    }));
    const pool = await import("../../lib/provider-pool");
    const availability = await import("../../lib/provider-availability");
    return { pool, availability };
  }

  beforeEach(() => {
    fake.hashes.clear();
    fake.values.clear();
    fake.broken = false;
    vi.unstubAllEnvs();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    // doMock persists across tests in this file; later suites need the real module.
    vi.doUnmock("../../lib/openrouter-free");
  });

  it("always starts with a static entry and ends with the discovered ones", async () => {
    const { pool, availability } = await setup();
    availability.setAvailabilityFetch((async () => new Response("{}", { status: 500 })) as unknown as typeof fetch);
    const statics = [entry("A"), entry("B"), entry("C")];

    for (let i = 0; i < 8; i += 1) {
      const names = (await pool.getChain("ord", statics, { structured: false })).map((p) => p.name);
      expect(["A", "B", "C"]).toContain(names[0]);
      expect(names.slice(-2)).toEqual(["OR or/x:free", "OR or/y:free"]);
      expect(names).toHaveLength(5);
    }
  });

  it("puts discovered entries first only when every static entry is cooling down", async () => {
    const { pool, availability } = await setup();
    availability.setAvailabilityFetch((async () => new Response("{}", { status: 500 })) as unknown as typeof fetch);
    const statics = [entry("A"), entry("B")];
    for (const name of ["A", "B"]) {
      pool.recordProviderFailure("cd", name);
      pool.recordProviderFailure("cd", name);
    }

    const names = (await pool.getChain("cd", statics, { structured: false })).map((p) => p.name);

    expect(names.slice(0, 2)).toEqual(["OR or/x:free", "OR or/y:free"]);
    expect(new Set(names.slice(2))).toEqual(new Set(["A", "B"]));
  });

  it("drops an entry the provider no longer lists, and marks it unavailable", async () => {
    const { pool, availability } = await setup();
    availability.setAvailabilityFetch((async () =>
      json200({ data: [{ id: "A" }, { id: "C" }] })) as unknown as typeof fetch);
    const statics = [entry("A"), entry("B"), entry("C")];

    await availability.refreshAvailableModels("groq");
    const names = (await pool.getChain("av", statics, { structured: false })).map((p) => p.name);
    const status = pool.getPoolRuntimeStatus("av", statics);

    expect(names).not.toContain("B");
    expect(names).toContain("A");
    expect(status.providers.find((p) => p.name === "B")?.status).toBe("unavailable");
    expect(status.ready).toBe(2);
  });

  it("does not count a retired entry as usable", async () => {
    const { pool, availability } = await setup();
    vi.stubEnv("OPENROUTER_API_KEY", "");
    availability.setAvailabilityFetch((async () => json200({ data: [{ id: "other" }] })) as unknown as typeof fetch);
    const statics = [entry("A"), entry("B")];

    await availability.refreshAvailableModels("groq");
    const status = pool.getPoolRuntimeStatus("ret", statics);

    expect(status.providers.every((p) => p.status === "unavailable")).toBe(true);
    expect(status.discoveredEnabled).toBe(false);
    expect(status.usable).toBe(false);
  });

  it("stays usable through discovery when every static entry is retired", async () => {
    const { pool, availability } = await setup();
    availability.setAvailabilityFetch((async () => json200({ data: [{ id: "other" }] })) as unknown as typeof fetch);
    const statics = [entry("A")];

    await availability.refreshAvailableModels("groq");

    expect(pool.getPoolRuntimeStatus("ret2", statics).usable).toBe(true);
  });

  it("rotates only the primary entries and keeps the rest after them", async () => {
    const { pool, availability } = await setup();
    availability.setAvailabilityFetch((async () => new Response("{}", { status: 500 })) as unknown as typeof fetch);
    const statics = [entry("P1"), entry("P2"), entry("P3"), entry("L1"), entry("L2")];
    const firsts = new Set<string>();

    for (let i = 0; i < 9; i += 1) {
      const names = (
        await pool.getChain("prim", statics, { structured: false, primaryCount: 3 })
      ).map((p) => p.name);
      firsts.add(names[0]);
      expect(["P1", "P2", "P3"]).toContain(names[0]);
      expect(new Set(names.slice(0, 3))).toEqual(new Set(["P1", "P2", "P3"]));
      expect(names.slice(3)).toEqual(["L1", "L2", "OR or/x:free", "OR or/y:free"]);
    }
    expect(firsts).toEqual(new Set(["P1", "P2", "P3"]));
  });

  it("falls to the later entries when every primary is cooling down", async () => {
    const { pool, availability } = await setup();
    availability.setAvailabilityFetch((async () => new Response("{}", { status: 500 })) as unknown as typeof fetch);
    const statics = [entry("P1"), entry("P2"), entry("L1")];
    for (const name of ["P1", "P2"]) {
      pool.recordProviderFailure("primcd", name);
      pool.recordProviderFailure("primcd", name);
    }

    const names = (
      await pool.getChain("primcd", statics, { structured: false, primaryCount: 2 })
    ).map((p) => p.name);

    expect(names[0]).toBe("L1");
  });

  it("excludes nothing when the live list could not be fetched", async () => {
    const { pool, availability } = await setup();
    availability.setAvailabilityFetch((async () => {
      throw new Error("down");
    }) as unknown as typeof fetch);
    const statics = [entry("A"), entry("B")];

    await availability.refreshAvailableModels("groq");
    const names = (await pool.getChain("fail", statics, { structured: false })).map((p) => p.name);

    expect(names).toContain("A");
    expect(names).toContain("B");
    expect(pool.getPoolRuntimeStatus("fail", statics).ready).toBe(2);
  });
});

function json200(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
