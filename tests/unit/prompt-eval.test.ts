import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkGenerateOutput } from "../../lib/prompt-eval";

const tier = (platform_id: string) => ({
  platform_id,
  model_name: "Some Model",
  reasoning: "Fits the task.",
});

const PARAGRAPH =
  "Role: You are a senior browser extension engineer. Build a Chrome extension (Manifest V3) that tracks the time spent on each website.";
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
      "Create an image: A cyberpunk cat sipping tea on a rainy old Dhaka street at night, neon reflections on wet cobblestones, shallow depth of field, cinematic 35mm look, warm lantern glow against cool blue shadows, rickshaws blurred in the background, 8k, highly detailed, steam rising from the cup, moody atmosphere.";
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
    const prompt = "Create an image: A cat drinking tea on a rainy street in old Dhaka, neon light on wet stone, cinematic framing, shallow depth of field, warm lantern glow, steam rising from the cup, moody blue shadows, rickshaws blurred behind, detailed fur texture and reflections.";
    const out = make(prompt, { open_source: "deepseek", freemium: "gemini", premium: "claude" });
    expect(checkGenerateOutput(out, "image").join("\n")).toMatch(/image generation/i);
  });

  it("flags a vague output with no assumptions or question", () => {
    expect(checkGenerateOutput(make(BODY), "vague").join("\n")).toMatch(/vague/i);
    const ok = make(`${BODY}\n\nFirst ask the user which subject the exam covers.`);
    expect(checkGenerateOutput(ok, "vague")).toEqual([]);
  });

  it("no longer accepts a bare Assumptions section as handling vagueness", () => {
    const only = make(`${BODY}\n\nAssumptions: the student has four weeks.`);
    expect(checkGenerateOutput(only, "vague").join("\n")).toMatch(/vague/i);
  });

  it("accepts the other ask-first phrasings", () => {
    for (const line of [
      "Ask me which subject first.",
      "Start by asking which subject the exam covers.",
      "Before you begin, confirm the subject.",
      "Before continuing, confirm the subject.",
    ]) {
      expect(checkGenerateOutput(make(`${BODY}\n\n${line}`), "vague"), line).toEqual([]);
    }
  });

  it("flags a bangla output that never names Bangla", () => {
    expect(checkGenerateOutput(make(BODY), "bangla").join("\n")).toMatch(/bangla/i);
    expect(checkGenerateOutput(make(`${BODY}\n\nWrite in Bangla.`), "bangla")).toEqual([]);
  });

  it("flags leaked system prompt text on inject", () => {
    const issues = checkGenerateOutput(make(`${BODY}\n\nHOW TO ROUTE: pick models.`), "inject");
    expect(issues.join("\n")).toMatch(/HOW TO ROUTE/);
  });

  it("also flags the newer prompt markers on inject", () => {
    for (const marker of ["HOW TO WRITE", "[MODELS]", "[CHECK BEFORE ANSWERING]"]) {
      const issues = checkGenerateOutput(make(`${BODY}\n\n${marker} text.`), "inject");
      expect(issues.join("\n"), marker).toContain(marker);
    }
  });

  it("lets a short unsectioned prompt pass on inject", () => {
    const short = "Help the user decide what they want to make, then ask one short question about it.";
    expect(checkGenerateOutput(make(short), "inject")).toEqual([]);
    expect(checkGenerateOutput(make(short), "general").join("\n")).toMatch(/length|sections/);
  });

  it("requires three labeled lines for sectioned kinds", () => {
    const two = "Role: You are a helper.\n\nTask: " + "do a thing well, ".repeat(20);
    expect(checkGenerateOutput(make(two), "general").join("\n")).toMatch(/sections/);
    const three = `${two}\n\nDeliverable: a short answer.`;
    expect(checkGenerateOutput(make(three), "general")).toEqual([]);
  });

  it("does not count prose with a colon mid-sentence as a label", () => {
    const prose = `${"Write the post, then check the result: it must be warm. ".repeat(5)}\n\nMore text here, nothing labeled in it at all.\n\nAnd one more block without any label.`;
    expect(checkGenerateOutput(make(prose), "writing").join("\n")).toMatch(/sections/);
  });

  it("requires image prompts to start with Create an image:", () => {
    const body =
      " A cat drinking tea on a rainy street in old Dhaka, neon light on wet stone, cinematic framing, shallow depth of field, warm lantern glow, steam rising from the cup, moody blue shadows, rickshaws blurred behind, detailed fur texture and reflections.";
    const routing = { open_source: "huggingface", freemium: "gemini", premium: "chatgpt" };
    expect(checkGenerateOutput(make(`Draw${body}`, routing), "image").join("\n")).toMatch(/Create an image:/);
    expect(checkGenerateOutput(make(`create an image:${body}`, routing), "image")).toEqual([]);
  });

  it("flags brace and angle-bracket blanks", () => {
    expect(checkGenerateOutput(make(`${BODY}\n\nFor {business name} only.`), "code").join("\n")).toMatch(/bracket/i);
    expect(checkGenerateOutput(make(`${BODY}\n\nFor <insert name> only.`), "code").join("\n")).toMatch(/bracket/i);
    expect(checkGenerateOutput(make(`${BODY}\n\nFor <your shop> only.`), "code").join("\n")).toMatch(/bracket/i);
  });

  it("checks model names against the landscape when one is given", () => {
    const landscape = { models: "OpenAI GPT: GPT-5 (open-weight), GPT-4", imageModels: "Google Gemini: Nano Banana 3" };
    const named = (open: string, free: string, prem: string) => ({
      optimized_prompt: BODY,
      routing: {
        open_source: { platform_id: "deepseek", model_name: open, reasoning: "x" },
        freemium: { platform_id: "gemini", model_name: free, reasoning: "x" },
        premium: { platform_id: "claude", model_name: prem, reasoning: "x" },
      },
    });
    expect(checkGenerateOutput(named("GPT-5", "GPT-4", "Nano Banana 3"), "code", landscape)).toEqual([]);
    expect(checkGenerateOutput(named("GPT-5 (open-weight)", "GPT-4", "GPT-4"), "code", landscape)).toEqual([]);
    const issues = checkGenerateOutput(named("GPT-9", "GPT-4", "GPT-4"), "code", landscape);
    expect(issues.join("\n")).toMatch(/model_name.*GPT-9/);
    // Without a landscape the names are not compared.
    expect(checkGenerateOutput(named("GPT-9", "GPT-4", "GPT-4"), "code")).toEqual([]);
  });

  it("flags schema violations", () => {
    expect(checkGenerateOutput({ nope: 1 }, "general").join("\n")).toMatch(/schema/i);
  });
});

describe("live eval file", () => {
  const src = readFileSync("tests/eval/generate.eval.test.ts", "utf8");

  it("blanks every Redis variable before importing app modules", () => {
    for (const name of [
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "KV_REST_API_URL",
      "KV_REST_API_TOKEN",
    ]) {
      expect(src).toContain(`process.env.${name} = "";`);
    }
    expect(src.indexOf("KV_REST_API_TOKEN")).toBeLessThan(src.indexOf('await import("../../app/api/generate/route")'));
  });

  it("checks the output outside the JSON parse and guards the POST call", () => {
    expect(src).toContain("getLiveModelLandscape");
    expect(src).toMatch(/try\s*\{\s*res = await POST/);
    expect(src).not.toMatch(/issues = checkGenerateOutput\(json, kind\);\s*\}\s*catch/);
  });

  describe("pinned versions", () => {
    const versions = (out: ReturnType<typeof make>, kind: Parameters<typeof checkGenerateOutput>[1]) =>
      checkGenerateOutput(out, kind).filter((i) => i.startsWith("versions:"));

    for (const pin of ["Next.js 14", "React 18", "Node 18+", "Python 3.10"]) {
      it(`flags ${pin}`, () => {
        const issues = versions(make(`${BODY}\n\nContext: build it with ${pin}.`), "code");
        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain(pin);
      });
    }

    it("accepts a latest-stable instruction", () => {
      const out = make(`${BODY}\n\nContext: Use the latest stable version of Next.js and React.`);
      expect(versions(out, "code")).toEqual([]);
    });

    it("exempts image outputs", () => {
      const prompt =
        "Create an image: A developer at a desk with a laptop showing React 18 code, warm lamp light, shallow depth of field, cinematic composition, calm evening mood, wide 16:9 frame, soft film grain, detailed keyboard and coffee cup in the foreground, window with city lights behind.";
      const out = make(prompt, { open_source: "huggingface", freemium: "gemini", premium: "chatgpt" });
      expect(versions(out, "image")).toEqual([]);
    });
  });
});
