import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLARIFY_SYSTEM_PROMPT } from "../../lib/prompts/clarify-system-prompt";
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

  it("appends the three blocks in order after their headers, then the check block", () => {
    const tail = out.slice(GENERATE_BASE_PROMPT.length);
    expect(tail).toBe(
      "\n\n[PLATFORMS]\nREGISTRY_TEXT\n\n[MODELS]\nMODELS_TEXT\n\n[IMAGE MODELS]\nIMAGE_TEXT" +
        "\n\n[CHECK BEFORE ANSWERING]\n" +
        '- optimized_prompt: "Label:" sections with an empty line (\\n\\n) between them; image prompts are one paragraph starting with "Create an image:".\n' +
        "- No invented facts and no fill-in slots.\n" +
        '- model_name copied from the lists above without "(open-weight)"; each platform_id serves its tier.',
    );
  });

  it("shows the model a literal backslash-n pair in the formatting rule", () => {
    expect(GENERATE_BASE_PROMPT).toContain(
      'inside the JSON string that is two newline characters, for example "Role: ...\\n\\nTask: ...\\n\\nDeliverable: ..."',
    );
    expect(GENERATE_BASE_PROMPT).toContain("Put one empty line between sections");
    expect(GENERATE_BASE_PROMPT).toContain("Image prompts are the exception: one paragraph, no empty lines.");
  });

  it("keeps image prompts free of Assumptions and anchors them with Create an image", () => {
    expect(GENERATE_BASE_PROMPT).toContain(
      "Do not add an Assumptions section to image prompts; state any default you chose (style, aspect ratio) inside the paragraph. Begin image prompts with \"Create an image:\" so a chat assistant renders the image instead of describing it.",
    );
    expect(GENERATE_BASE_PROMPT).toContain('final "Assumptions:" section (image prompts excepted, see 2)');
  });

  it("forbids invented facts and every kind of fill-in slot", () => {
    expect(GENERATE_BASE_PROMPT).toContain(
      "Refer to unknown facts in plain words inside the sentence, for example the attached spreadsheet or the shop's location.",
    );
    expect(GENERATE_BASE_PROMPT).toContain(
      'Never leave fill-in slots of any kind: no [brackets], {braces}, <angle brackets>, quoted blanks such as "your business name", or ALL-CAPS placeholders.',
    );
  });

  it("routes open-weight, model_name and image tasks with the marker rules", () => {
    expect(GENERATE_BASE_PROMPT).toContain(
      '- open_source: an open-weight model (marked "(open-weight)" in [MODELS]) on a platform whose tiers include open_source. If no model is marked, use a model listed for a platform whose tiers include open_source.',
    );
    expect(GENERATE_BASE_PROMPT).toContain(
      '- model_name: copy a name exactly as written in [MODELS], or in [IMAGE MODELS] for image tasks, but leave out the "(open-weight)" marker.',
    );
    expect(GENERATE_BASE_PROMPT).toContain(
      "never claim a text model generates images itself.",
    );
    expect(GENERATE_BASE_PROMPT).toContain(
      "say in reasoning that the platform's built-in image tool does the rendering",
    );
  });

  it("gives the safety paragraph a fallback when nothing legitimate remains", () => {
    expect(GENERATE_BASE_PROMPT).toContain(
      "If nothing legitimate remains, write a short general prompt that asks the AI to help the user decide what they want to make, and route it as a general chat task.",
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

describe("clarify system prompt", () => {
  it("asks about scope for code and one thing per question", () => {
    expect(CLARIFY_SYSTEM_PROMPT).toContain(
      "  - code: platform or stack, scope (quick prototype or full app), deliverable",
    );
    expect(CLARIFY_SYSTEM_PROMPT).toContain(
      "- Each question asks about one thing; never combine two choices in one question.",
    );
  });
});

describe("generate schema description", () => {
  it("tells the model about paragraph separation with a literal backslash-n pair", async () => {
    const { GenerateSchemaObject } = await import("../../lib/generate-schema");
    const desc = GenerateSchemaObject.shape.optimized_prompt.description;
    expect(desc).toBe(
      'Plain-text prompt. "Label:" sections separated by an empty line (\\n\\n); image prompts are a single paragraph.',
    );
  });
});
