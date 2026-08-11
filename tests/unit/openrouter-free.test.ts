import { describe, expect, it } from "vitest";
import {
  isUsableFreeModel,
  selectFreeModels,
  supportsStructuredOutput,
  type OpenRouterCatalogueModel,
} from "../../lib/openrouter-free";

function model(overrides: Partial<OpenRouterCatalogueModel> = {}): OpenRouterCatalogueModel {
  return {
    id: "vendor/model:free",
    pricing: { prompt: "0", completion: "0" },
    context_length: 100000,
    supported_parameters: ["structured_outputs"],
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    ...overrides,
  };
}

describe("isUsableFreeModel", () => {
  it("accepts a zero-priced :free chat model", () => {
    expect(isUsableFreeModel(model())).toBe(true);
  });

  it("rejects paid models", () => {
    expect(isUsableFreeModel(model({ id: "vendor/model", pricing: { prompt: "0.0000012", completion: "0.000005" } }))).toBe(false);
  });

  it("rejects a :free id that is not actually zero-priced", () => {
    expect(isUsableFreeModel(model({ pricing: { prompt: "0.0000001", completion: "0" } }))).toBe(false);
  });

  it("rejects a model with no pricing block", () => {
    expect(isUsableFreeModel(model({ pricing: undefined }))).toBe(false);
  });

  it("rejects safety and moderation models", () => {
    expect(isUsableFreeModel(model({ id: "nvidia/nemotron-3.5-content-safety:free" }))).toBe(false);
    expect(isUsableFreeModel(model({ id: "meta/llama-guard:free" }))).toBe(false);
  });

  it("rejects models that cannot emit text", () => {
    expect(
      isUsableFreeModel(model({ architecture: { input_modalities: ["text"], output_modalities: ["image"] } })),
    ).toBe(false);
  });

  it("assumes text when the architecture block is missing", () => {
    expect(isUsableFreeModel(model({ architecture: undefined }))).toBe(true);
  });
});

describe("supportsStructuredOutput", () => {
  it("reads the supported_parameters list", () => {
    expect(supportsStructuredOutput(model())).toBe(true);
    expect(supportsStructuredOutput(model({ supported_parameters: ["tools"] }))).toBe(false);
    expect(supportsStructuredOutput(model({ supported_parameters: undefined }))).toBe(false);
  });
});

describe("selectFreeModels", () => {
  const catalogue = [
    model({ id: "a/small:free", context_length: 1000 }),
    model({ id: "b/large:free", context_length: 900000 }),
    model({ id: "c/plain:free", context_length: 500000, supported_parameters: ["tools"] }),
    model({ id: "d/paid", pricing: { prompt: "0.001", completion: "0.002" } }),
  ];

  it("keeps only structured models when structured output is required", () => {
    const picked = selectFreeModels(catalogue, { structured: true }).map((m) => m.id);
    expect(picked).toEqual(["b/large:free", "a/small:free"]);
  });

  it("includes non-structured models when it is not required", () => {
    const picked = selectFreeModels(catalogue, { structured: false }).map((m) => m.id);
    expect(picked).toEqual(["b/large:free", "c/plain:free", "a/small:free"]);
  });

  it("orders by context length so the rotation is deterministic", () => {
    const picked = selectFreeModels(catalogue, { structured: false });
    expect(picked[0].contextLength).toBeGreaterThan(picked[1].contextLength);
  });

  it("caps how many models join the chain", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      model({ id: `v/m${i}:free`, context_length: 1000 + i }),
    );
    expect(selectFreeModels(many, { structured: true })).toHaveLength(4);
  });

  it("honours an explicit limit", () => {
    expect(selectFreeModels(catalogue, { structured: false, limit: 1 })).toHaveLength(1);
  });

  it("returns nothing for an empty catalogue", () => {
    expect(selectFreeModels([], { structured: true })).toEqual([]);
  });
});
