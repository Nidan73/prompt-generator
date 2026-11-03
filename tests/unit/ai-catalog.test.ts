import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildImageLandscapeFromCatalogue,
  buildLandscapeFromCatalogue,
} from "../../lib/ai-catalog";

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

describe("open-weight markers", () => {
  it("suffixes models that carry a hugging_face_id", () => {
    const out = buildLandscapeFromCatalogue([
      { id: "deepseek/deepseek-v4", name: "DeepSeek: DeepSeek V4", created: 2, hugging_face_id: "deepseek-ai/V4" },
      { id: "deepseek/deepseek-v3", name: "DeepSeek: DeepSeek V3", created: 1, hugging_face_id: "" },
    ]);
    expect(out).toContain("DeepSeek V4 (open-weight)");
    expect(out).not.toContain("DeepSeek V3 (open-weight)");
  });

  it("appends the newest open-weight model for an open_source vendor with none selected", () => {
    const out = buildLandscapeFromCatalogue([
      { id: "mistralai/a", name: "Mistral: A", created: 10 },
      { id: "mistralai/b", name: "Mistral: B", created: 9 },
      { id: "mistralai/c", name: "Mistral: C", created: 8 },
      { id: "mistralai/d", name: "Mistral: D", created: 7, hugging_face_id: "m/d" },
      { id: "mistralai/e", name: "Mistral: E", created: 6, hugging_face_id: "m/e" },
    ]);
    expect(out).toContain("- Mistral: A, B, C, D (open-weight) → use platform [mistral]");
    expect(out).not.toContain("E (open-weight)");
  });

  it("does not append when an open-weight model is already selected", () => {
    const out = buildLandscapeFromCatalogue([
      { id: "mistralai/a", name: "Mistral: A", created: 10, hugging_face_id: "m/a" },
      { id: "mistralai/b", name: "Mistral: B", created: 9 },
      { id: "mistralai/c", name: "Mistral: C", created: 8 },
      { id: "mistralai/d", name: "Mistral: D", created: 7, hugging_face_id: "m/d" },
    ]);
    expect(out).toContain("- Mistral: A (open-weight), B, C → use platform");
  });

  it("does not append for a vendor whose platform lacks the open_source tier", () => {
    const out = buildLandscapeFromCatalogue([
      { id: "google/gemini-a", name: "Google: Gemini A", created: 10 },
      { id: "google/gemini-b", name: "Google: Gemini B", created: 9 },
      { id: "google/gemini-c", name: "Google: Gemini C", created: 8 },
      { id: "google/gemini-d", name: "Google: Gemma D", created: 7, hugging_face_id: "g/d" },
    ]);
    expect(out).toContain("- Google Gemini: Gemini A, Gemini B, Gemini C → use platform [gemini]");
    expect(out).not.toContain("Gemma D");
  });

  it("leaves image naming to the modality filter, not to name matching", () => {
    const out = buildLandscapeFromCatalogue([
      { id: "google/gemini-a", name: "Google: Nano Banana Writer", created: 2, architecture: { output_modalities: ["text"] } },
      { id: "google/gemini-b", name: "Google: Gemini Image 2 Helper", created: 1 },
      { id: "google/gemini-c", name: "Google: Gemini Pix", created: 3, architecture: { output_modalities: ["image"] } },
    ]);
    expect(out).toContain("Nano Banana Writer");
    expect(out).toContain("Gemini Image 2 Helper");
    expect(out).not.toContain("Gemini Pix");
  });

  it("excludes exp and experimental names", () => {
    const out = buildLandscapeFromCatalogue([
      { id: "deepseek/deepseek-a", name: "DeepSeek: V4 Flash Vision Exp", created: 3 },
      { id: "deepseek/deepseek-b", name: "DeepSeek: V4 Experimental", created: 2 },
      { id: "deepseek/deepseek-c", name: "DeepSeek: V4 Expert", created: 1 },
    ]);
    expect(out).not.toMatch(/Vision Exp|Experimental/);
    expect(out).toContain("V4 Expert");
  });

  it("no longer hardcodes an image routing note", () => {
    const out = buildLandscapeFromCatalogue([{ id: "openai/gpt-5", name: "OpenAI: GPT-5", created: 1 }]);
    expect(out).not.toMatch(/image/i);
  });
});

describe("buildImageLandscapeFromCatalogue", () => {
  const img = ["text", "image"];
  it("selects image-output models, 3 newest per vendor, skipping preview and openrouter/", () => {
    const out = buildImageLandscapeFromCatalogue([
      { id: "google/gemini-a-image", name: "Google: Nano Banana 1", created: 1, architecture: { output_modalities: img } },
      { id: "google/gemini-b-image", name: "Google: Nano Banana 2", created: 2, architecture: { output_modalities: img } },
      { id: "google/gemini-c-image", name: "Google: Nano Banana 3", created: 3, architecture: { output_modalities: img } },
      { id: "google/gemini-d-image", name: "Google: Nano Banana Preview", created: 9, architecture: { output_modalities: img } },
      { id: "openai/gpt-x-image", name: "OpenAI: GPT X Image", created: 5, architecture: { output_modalities: img } },
      { id: "openrouter/auto-image", name: "Router Image", created: 8, architecture: { output_modalities: img } },
      { id: "google/gemini-text", name: "Google: Gemini Text", created: 7, architecture: { output_modalities: ["text"] } },
    ]);
    expect(out).toBe(
      "OpenAI GPT: GPT X Image → [chatgpt]\nGoogle Gemini: Nano Banana 3, Nano Banana 2, Nano Banana 1 → [gemini]",
    );
  });

  it("returns null when nothing matches", () => {
    expect(buildImageLandscapeFromCatalogue([])).toBeNull();
    expect(
      buildImageLandscapeFromCatalogue([{ id: "openai/gpt-5", name: "OpenAI: GPT-5", created: 1 }]),
    ).toBeNull();
  });
});

describe("getLiveModelLandscape fallback order", () => {
  const redisGet = vi.fn();
  const redisSet = vi.fn();
  const redisCtor = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    redisGet.mockReset();
    redisSet.mockReset().mockResolvedValue("OK");
    redisCtor.mockClear();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.doMock("@upstash/redis", () => ({
      Redis: class {
        constructor() {
          redisCtor();
          return { get: redisGet, set: redisSet };
        }
      },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.doUnmock("@upstash/redis");
  });

  const okFetch = () =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "openai/gpt-5", name: "OpenAI: GPT-5", created: 1 },
          { id: "openai/gpt-5-image", name: "OpenAI: GPT-5 Image", created: 2, architecture: { output_modalities: ["image"] } },
        ],
      }),
    });

  it("stores a snapshot on a live build, then prefers memory, then Redis, then static", async () => {
    vi.stubGlobal("fetch", okFetch());
    const mod = await import("../../lib/ai-catalog");

    const live = await mod.getLiveModelLandscape();
    expect(live.models).toContain("GPT-5");
    expect(live.imageModels).toContain("GPT-5 Image");
    expect(mod.getModelLandscapeCacheState().source).toBe("live");
    expect(redisSet).toHaveBeenCalledTimes(1);
    const [key, payload, opts] = redisSet.mock.calls[0];
    expect(key).toBe("btq:model-landscape:last-good");
    expect(JSON.parse(payload)).toMatchObject({ models: live.models, imageModels: live.imageModels });
    expect(opts).toEqual({ ex: 7 * 24 * 60 * 60 });

    // Expired memory beats Redis when the fetch fails.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    vi.advanceTimersByTime(7 * 60 * 60 * 1000);
    redisGet.mockResolvedValue(JSON.stringify({ models: "REDIS", imageModels: "REDIS", fetchedAt: 1 }));
    const stale = await mod.getLiveModelLandscape();
    expect(stale).toEqual(live);
    expect(redisGet).not.toHaveBeenCalled();
  });

  it("uses the Redis snapshot when memory is empty, then static when Redis is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    redisGet.mockResolvedValue(JSON.stringify({ models: "REDIS M", imageModels: "REDIS I", fetchedAt: 1 }));
    let mod = await import("../../lib/ai-catalog");
    expect(await mod.getLiveModelLandscape()).toEqual({ models: "REDIS M", imageModels: "REDIS I" });
    expect(mod.getModelLandscapeCacheState().source).toBe("snapshot");

    vi.resetModules();
    redisGet.mockResolvedValue(null);
    mod = await import("../../lib/ai-catalog");
    const fb = await mod.getLiveModelLandscape();
    expect(fb.models).toContain("Claude");
    expect(fb.imageModels).toBe("none listed");
    expect(mod.getModelLandscapeCacheState().source).toBe("fallback");
  });
  const snapshotCases: Array<[string, unknown]> = [
    ["malformed JSON", "{not json"],
    ["wrong shape", JSON.stringify({ models: 5, imageModels: "x" })],
    ["empty models", JSON.stringify({ models: "   ", imageModels: "x", fetchedAt: 1 })],
    ["oversized models", JSON.stringify({ models: "m".repeat(20001), imageModels: "x", fetchedAt: 1 })],
    ["oversized image models", JSON.stringify({ models: "m", imageModels: "i".repeat(20001), fetchedAt: 1 })],
    ["a bare number", 42],
  ];

  for (const [label, raw] of snapshotCases) {
    it(`ignores a snapshot with ${label}`, async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
      redisGet.mockResolvedValue(raw);
      const mod = await import("../../lib/ai-catalog");
      const out = await mod.getLiveModelLandscape();
      expect(out.models).toContain("Claude");
      expect(mod.getModelLandscapeCacheState().source).toBe("fallback");
    });
  }

  it("accepts a snapshot at exactly the size cap", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const models = "m".repeat(20000);
    redisGet.mockResolvedValue(JSON.stringify({ models, imageModels: "i".repeat(20000), fetchedAt: 1 }));
    const mod = await import("../../lib/ai-catalog");
    expect((await mod.getLiveModelLandscape()).models).toBe(models);
    expect(mod.getModelLandscapeCacheState().source).toBe("snapshot");
  });

  it("builds no Redis client and falls back to static text when Redis env is empty", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const mod = await import("../../lib/ai-catalog");
    const out = await mod.getLiveModelLandscape();
    expect(out.models).toContain("Claude");
    expect(redisCtor).not.toHaveBeenCalled();
    expect(mod.getModelLandscapeCacheState().source).toBe("fallback");
  });

  it("gives up on a hung snapshot read after one second", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    redisGet.mockReturnValue(new Promise(() => {}));
    const mod = await import("../../lib/ai-catalog");
    const pending = mod.getLiveModelLandscape();
    await vi.advanceTimersByTimeAsync(1000);
    const out = await pending;
    expect(out.models).toContain("Claude");
    expect(mod.getModelLandscapeCacheState().source).toBe("fallback");
  });

  it("returns an expired cache immediately and refreshes once in the background", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const mod = await import("../../lib/ai-catalog");
    const first = await mod.getLiveModelLandscape();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The refresh stays pending so we can prove callers do not wait on it.
    let release!: (v: unknown) => void;
    const slow = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    vi.stubGlobal("fetch", slow);
    vi.advanceTimersByTime(7 * 60 * 60 * 1000);

    const a = await mod.getLiveModelLandscape();
    const b = await mod.getLiveModelLandscape();
    expect(a).toEqual(first);
    expect(b).toEqual(first);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(mod.getModelLandscapeCacheState().inFlight).toBe(true);

    release({
      ok: true,
      json: async () => ({ data: [{ id: "openai/gpt-6", name: "OpenAI: GPT-6", created: 9 }] }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mod.getModelLandscapeCacheState().inFlight).toBe(false);
    expect((await mod.getLiveModelLandscape()).models).toContain("GPT-6");
  });

  it("blocks only on a true cold start", async () => {
    let release!: (v: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      ),
    );
    const mod = await import("../../lib/ai-catalog");
    let settled = false;
    const pending = mod.getLiveModelLandscape().then((v) => {
      settled = true;
      return v;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    release({
      ok: true,
      json: async () => ({ data: [{ id: "openai/gpt-5", name: "OpenAI: GPT-5", created: 1 }] }),
    });
    expect((await pending).models).toContain("GPT-5");
  });
});
