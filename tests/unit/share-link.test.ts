import { describe, expect, it } from "vitest";
import { decodePromptFromHash, encodePromptToHash } from "../../lib/share-link";

describe("share-link", () => {
  it("round trips an ASCII prompt", () => {
    const prompt = "Write a haiku about the sea.";
    const hash = encodePromptToHash(prompt);
    expect(hash.startsWith("#v1-")).toBe(true);
    expect(decodePromptFromHash(hash)).toBe(prompt);
  });

  it("round trips a Bengali and emoji prompt", () => {
    const prompt = "আমাকে একটি কবিতা লিখে দাও 🍉🌊";
    expect(decodePromptFromHash(encodePromptToHash(prompt))).toBe(prompt);
  });

  it("returns null without the v1 prefix", () => {
    expect(decodePromptFromHash("")).toBeNull();
    expect(decodePromptFromHash("#abc")).toBeNull();
    expect(decodePromptFromHash("#v2-abc")).toBeNull();
  });

  it("returns null for an empty payload", () => {
    expect(decodePromptFromHash("#v1-")).toBeNull();
  });

  it("returns null for a garbage payload without throwing", () => {
    expect(() => decodePromptFromHash("#v1-!!!@@@###")).not.toThrow();
    expect(decodePromptFromHash("#v1-!!!@@@###")).toBeNull();
  });

  it("returns null when the decoded text is whitespace only", () => {
    expect(decodePromptFromHash(encodePromptToHash("   \n\t "))).toBeNull();
  });
});
