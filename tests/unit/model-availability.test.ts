import { describe, expect, it } from "vitest";
import { findMissingModels } from "../../lib/model-availability";

const pools = {
  generate: [
    { name: "G A", provider: "groq", modelId: "a" },
    { name: "Gem B", provider: "gemini", modelId: "b" },
  ],
  refine: [{ name: "G A", provider: "groq", modelId: "a" }],
};

describe("findMissingModels", () => {
  it("returns nothing when every model is available", () => {
    const missing = findMissingModels(pools, {
      groq: new Set(["a"]),
      gemini: new Set(["b"]),
    });
    expect(missing).toEqual([]);
  });

  it("reports a missing model with pool, name and modelId", () => {
    const missing = findMissingModels(pools, {
      groq: new Set(["a"]),
      gemini: new Set(["other"]),
    });
    expect(missing).toEqual([
      { pool: "generate", name: "Gem B", provider: "gemini", modelId: "b" },
    ]);
  });

  it("skips providers with no available set", () => {
    expect(findMissingModels(pools, { groq: new Set(["a"]) })).toEqual([]);
  });

  it("reports a duplicate model once per pool", () => {
    const missing = findMissingModels(pools, { groq: new Set() });
    expect(missing.map((m) => m.pool)).toEqual(["generate", "refine"]);
  });
});
