import { describe, expect, it } from "vitest";
import {
  GenerateRequestSchema,
  MAX_CLARIFICATIONS,
  PROMPT_MAX_CHARS,
  RefineRequestSchema,
} from "../../lib/api-schemas";

function clarifications(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    question: `q${i}`,
    answer: `a${i}`,
  }));
}

describe("GenerateRequestSchema", () => {
  it("accepts the browser extension's worst case", () => {
    // Guided mode asks 3 questions; the extension appends 4 quality
    // clarifications of its own. A cap below 7 breaks guided mode there.
    const result = GenerateRequestSchema.safeParse({
      prompt: "build a todo app",
      clarifications: clarifications(7),
    });

    expect(result.success).toBe(true);
  });

  it("keeps headroom above that worst case", () => {
    expect(MAX_CLARIFICATIONS).toBeGreaterThanOrEqual(7);
  });

  it("still rejects an unbounded array", () => {
    const result = GenerateRequestSchema.safeParse({
      prompt: "hello",
      clarifications: clarifications(MAX_CLARIFICATIONS + 1),
    });

    expect(result.success).toBe(false);
  });

  it("defaults clarifications to an empty array", () => {
    const result = GenerateRequestSchema.parse({ prompt: "hello" });
    expect(result.clarifications).toEqual([]);
  });

  it("requires a non-empty prompt and enforces the length cap", () => {
    expect(GenerateRequestSchema.safeParse({ prompt: "   " }).success).toBe(false);
    expect(
      GenerateRequestSchema.safeParse({ prompt: "x".repeat(PROMPT_MAX_CHARS + 1) }).success,
    ).toBe(false);
  });

  it("truncates over-long clarification fields rather than rejecting them", () => {
    const result = GenerateRequestSchema.parse({
      prompt: "hello",
      clarifications: [{ question: "q".repeat(500), answer: "a".repeat(5000) }],
    });

    expect(result.clarifications[0].question).toHaveLength(160);
    expect(result.clarifications[0].answer).toHaveLength(3000);
  });
});

describe("RefineRequestSchema", () => {
  it("requires both fields", () => {
    expect(RefineRequestSchema.safeParse({ currentPrompt: "x" }).success).toBe(false);
    expect(RefineRequestSchema.safeParse({ instruction: "x" }).success).toBe(false);
    expect(
      RefineRequestSchema.safeParse({ currentPrompt: "x", instruction: "y" }).success,
    ).toBe(true);
  });
});
