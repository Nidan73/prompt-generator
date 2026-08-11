import { describe, expect, it } from "vitest";
import { getRotatedChain, type ProviderConfig } from "../../lib/provider-pool";

function poolOf(names: string[]): ProviderConfig[] {
  return names.map((name) => ({
    name,
    // getRotatedChain only ever reads `name` and `hasKey`.
    sdkModel: null as unknown as ProviderConfig["sdkModel"],
    hasKey: true,
  }));
}

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
