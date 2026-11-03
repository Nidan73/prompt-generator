import { describe, expect, it } from "vitest";
import { buildLandscapeFromCatalogue } from "../../lib/ai-catalog";

describe("buildLandscapeFromCatalogue", () => {
  it("excludes :free ids and noisy names", () => {
    const out = buildLandscapeFromCatalogue([
      { id: "openai/gpt-5", name: "OpenAI: GPT-5", created: 10 },
      { id: "openai/gpt-5:free", name: "OpenAI: GPT-5 Free", created: 20 },
      { id: "openai/gpt-5-batch", name: "OpenAI: GPT-5 (batch)", created: 30 },
    ]);
    expect(out).toContain("GPT-5");
    expect(out).not.toContain("Free");
    expect(out).not.toContain("batch");
  });

  it("keeps the 3 newest per vendor and strips the vendor prefix", () => {
    const out = buildLandscapeFromCatalogue([
      { id: "anthropic/claude-a", name: "Anthropic: Claude A", created: 1 },
      { id: "anthropic/claude-b", name: "Anthropic: Claude B", created: 2 },
      { id: "anthropic/claude-c", name: "Anthropic: Claude C", created: 3 },
      { id: "anthropic/claude-d", name: "Anthropic: Claude D", created: 4 },
    ]);
    expect(out).toContain("- Anthropic Claude: Claude D, Claude C, Claude B → use platform [claude]");
    expect(out).not.toContain("Claude A");
    expect(out).not.toContain("Anthropic: ");
  });

  it("returns null for an empty or non-matching list", () => {
    expect(buildLandscapeFromCatalogue([])).toBeNull();
    expect(buildLandscapeFromCatalogue([{ id: "acme/foo", name: "Acme: Foo", created: 1 }])).toBeNull();
  });
});
