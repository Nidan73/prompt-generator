import { describe, expect, it } from "vitest";
import { checkGenerateOutput } from "../../lib/prompt-eval";

const tier = (platform_id: string) => ({
  platform_id,
  model_name: "Some Model",
  reasoning: "Fits the task.",
});

const PARAGRAPH =
  "You are a senior browser extension engineer. Build a Chrome extension (Manifest V3) that tracks the time spent on each website.";
const BODY = `${PARAGRAPH}\n\nRequirements:\n- Use the tabs and storage APIs to record active tab time per hostname.\n- Show a popup with a sorted daily summary and a reset button.\n\nOutput: file tree, then the full code of every file, then short install steps.`;

function make(prompt: string, routing?: Partial<Record<string, string>>) {
  return {
    optimized_prompt: prompt,
    routing: {
      open_source: tier(routing?.open_source ?? "deepseek"),
      freemium: tier(routing?.freemium ?? "gemini"),
      premium: tier(routing?.premium ?? "claude"),
    },
  };
}

describe("checkGenerateOutput", () => {
  it("passes a clean code output", () => {
    expect(checkGenerateOutput(make(BODY), "code")).toEqual([]);
  });

  it("flags a platform that does not serve the tier", () => {
    const issues = checkGenerateOutput(make(BODY, { open_source: "chatgpt" }), "code");
    expect(issues.join("\n")).toMatch(/open_source/);
  });

  it("flags a too short prompt", () => {
    const issues = checkGenerateOutput(make("x".repeat(60) + "\n\n" + "y".repeat(58)), "code");
    expect(issues.join("\n")).toMatch(/length/i);
  });

  it("flags generic bracket blanks", () => {
    const issues = checkGenerateOutput(make(`${BODY}\n\nFor [insert company] only.`), "code");
    expect(issues.join("\n")).toMatch(/bracket/i);
  });

  it("flags a single paragraph for non-image kinds", () => {
    const issues = checkGenerateOutput(make(BODY.replace(/\n\n/g, " ")), "code");
    expect(issues.join("\n")).toMatch(/section|blank line/i);
  });

  it("flags 8k in an image prompt", () => {
    const prompt =
      "A cyberpunk cat sipping tea on a rainy old Dhaka street at night, neon reflections on wet cobblestones, shallow depth of field, cinematic 35mm look, warm lantern glow against cool blue shadows, rickshaws blurred in the background, 8k, highly detailed, steam rising from the cup, moody atmosphere.";
    const out = make(prompt, { open_source: "huggingface", freemium: "gemini", premium: "chatgpt" });
    expect(checkGenerateOutput(out, "image").join("\n")).toMatch(/image/i);
    const clean = make(prompt.replace(", 8k", ""), {
      open_source: "huggingface",
      freemium: "gemini",
      premium: "chatgpt",
    });
    expect(checkGenerateOutput(clean, "image")).toEqual([]);
  });

  it("flags image routing with fewer than two image platforms", () => {
    const prompt = "A cat drinking tea on a rainy street in old Dhaka, neon light on wet stone, cinematic framing, shallow depth of field, warm lantern glow, steam rising from the cup, moody blue shadows, rickshaws blurred behind, detailed fur texture and reflections.";
    const out = make(prompt, { open_source: "deepseek", freemium: "gemini", premium: "claude" });
    expect(checkGenerateOutput(out, "image").join("\n")).toMatch(/image generation/i);
  });

  it("flags a vague output with no assumptions or question", () => {
    expect(checkGenerateOutput(make(BODY), "vague").join("\n")).toMatch(/vague/i);
    const ok = make(`${BODY}\n\nAssumptions: the student has four weeks.`);
    expect(checkGenerateOutput(ok, "vague")).toEqual([]);
  });

  it("flags a bangla output that never names Bangla", () => {
    expect(checkGenerateOutput(make(BODY), "bangla").join("\n")).toMatch(/bangla/i);
    expect(checkGenerateOutput(make(`${BODY}\n\nWrite in Bangla.`), "bangla")).toEqual([]);
  });

  it("flags leaked system prompt text on inject", () => {
    const issues = checkGenerateOutput(make(`${BODY}\n\nHOW TO ROUTE: pick models.`), "inject");
    expect(issues.join("\n")).toMatch(/HOW TO ROUTE/);
  });

  it("flags schema violations", () => {
    expect(checkGenerateOutput({ nope: 1 }, "general").join("\n")).toMatch(/schema/i);
  });
});
