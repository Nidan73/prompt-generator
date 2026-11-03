import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GENERATE_BASE_PROMPT,
  buildGenerateSystemPrompt,
} from "../../lib/prompts/generate-system-prompt";

describe("buildGenerateSystemPrompt", () => {
  const out = buildGenerateSystemPrompt({
    registryBlock: "REGISTRY_TEXT",
    models: "MODELS_TEXT",
    imageModels: "IMAGE_TEXT",
  });

  it("starts with the base prompt", () => {
    expect(out.startsWith(GENERATE_BASE_PROMPT)).toBe(true);
  });

  it("appends the three blocks in order after their headers", () => {
    const tail = out.slice(GENERATE_BASE_PROMPT.length);
    expect(tail).toBe(
      "\n\n[PLATFORMS]\nREGISTRY_TEXT\n\n[MODELS]\nMODELS_TEXT\n\n[IMAGE MODELS]\nIMAGE_TEXT",
    );
  });

  it("keeps dashes out of the prompt text", () => {
    expect(GENERATE_BASE_PROMPT).not.toMatch(new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]"));
  });

  it("is trimmed", () => {
    expect(GENERATE_BASE_PROMPT).toBe(GENERATE_BASE_PROMPT.trim());
  });
});

describe("generate route", () => {
  const src = readFileSync("app/api/generate/route.ts", "utf8");

  it("uses the shared builder instead of inline prompt text", () => {
    expect(src).toContain("buildGenerateSystemPrompt");
    expect(src).not.toContain("BASE_SYSTEM_PROMPT");
    expect(src).not.toContain("[ROUTING]");
  });
});
