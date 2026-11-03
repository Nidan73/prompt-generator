import { describe, expect, it } from "vitest";
import { buildRegistryBlock, findPlatform, resolveRecommendations } from "../../lib/platform-registry";

describe("findPlatform", () => {
  it("matches a registry id directly", () => {
    expect(findPlatform("claude")?.id).toBe("claude");
  });

  it("resolves aliases", () => {
    expect(findPlatform("openai")?.id).toBe("chatgpt");
    expect(findPlatform("lechat")?.id).toBe("mistral");
  });

  it("tolerates casing, spacing and separators", () => {
    expect(findPlatform("  Hugging_Face ")?.id).toBe("huggingface");
    expect(findPlatform("DEEP-SEEK")?.id).toBe("deepseek");
  });

  it("returns undefined for unknown platforms", () => {
    expect(findPlatform("zzzz-nothing")).toBeUndefined();
  });
});

describe("resolveRecommendations", () => {
  const pick = (platform_id: string, model_name: string) => ({
    platform_id,
    model_name,
    reasoning: "because",
  });

  it("keeps a valid pick", () => {
    const r = resolveRecommendations({
      open_source: pick("deepseek", " DeepSeek V4 "),
      freemium: pick("gemini", "Gemini 3"),
      premium: pick("claude", "Claude Opus"),
    });
    expect(r.open_source).toEqual({
      model_name: "DeepSeek V4",
      platform_url: "https://chat.deepseek.com",
      reasoning: "because",
    });
    expect(r.premium.platform_url).toBe("https://claude.ai");
  });

  it("strips the open-weight marker from model names", () => {
    const r = resolveRecommendations({
      open_source: pick("deepseek", "DeepSeek V4 (open-weight)"),
      freemium: pick("gemini", "Gemini 3 (Open-Weight) "),
      premium: pick("claude", "Claude Opus"),
    });
    expect(r.open_source.model_name).toBe("DeepSeek V4");
    expect(r.freemium.model_name).toBe("Gemini 3");
  });

  it("falls back when the platform is invalid for the tier", () => {
    const r = resolveRecommendations({
      open_source: pick("claude", "Claude Opus"),
      freemium: pick("gemini", "Gemini 3"),
      premium: pick("claude", "Claude Opus"),
    });
    expect(r.open_source.platform_url).toBe("https://chat.deepseek.com");
    expect(r.open_source.reasoning).toBe("General-purpose recommendation.");
  });

  it("falls back on an empty model name", () => {
    const r = resolveRecommendations({
      open_source: pick("deepseek", "   "),
      freemium: pick("gemini", "Gemini 3"),
      premium: pick("claude", "Claude Opus"),
    });
    expect(r.open_source.model_name).toBe("DeepSeek");
  });
});

describe("buildRegistryBlock", () => {
  it("flags image generation only for the four capable platforms", () => {
    const lines = buildRegistryBlock().split("\n");
    const flagged = lines.filter((l) => l.endsWith(", image generation")).map((l) => l.slice(1, l.indexOf("]")));
    expect(flagged.sort()).toEqual(["chatgpt", "gemini", "grok", "huggingface"]);
    expect(lines).toContain("[gemini] Google Gemini: freemium/premium, image generation");
    expect(lines).toContain("[claude] Claude: freemium/premium");
  });
});
