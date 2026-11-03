import { beforeEach, describe, expect, it, vi } from "vitest";

// Never let a test construct a real Upstash client or hit a provider API.
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

async function fresh() {
  vi.resetModules();
  vi.stubEnv("GROQ_API_KEY", "g-key");
  vi.stubEnv("GEMINI_API_KEY", "m-key");
  return import("../../lib/provider-availability");
}

describe("provider availability", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("returns null on a cold cache and starts a refresh that fills it", async () => {
    const mod = await fresh();
    const fetchImpl = vi.fn(async () => json({ data: [{ id: "a" }, { id: "b" }] }));
    mod.setAvailabilityFetch(fetchImpl as unknown as typeof fetch);

    expect(mod.peekAvailableModelIds("groq")).toBeNull();
    await mod.refreshAvailableModels("groq");

    expect(mod.peekAvailableModelIds("groq")).toEqual(new Set(["a", "b"]));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/models");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer g-key");
  });

  it("deduplicates concurrent refreshes", async () => {
    const mod = await fresh();
    const fetchImpl = vi.fn(async () => json({ data: [{ id: "a" }] }));
    mod.setAvailabilityFetch(fetchImpl as unknown as typeof fetch);

    mod.peekAvailableModelIds("groq");
    mod.peekAvailableModelIds("groq");
    await mod.refreshAvailableModels("groq");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("follows Gemini pagination and strips the models/ prefix", async () => {
    const mod = await fresh();
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("pageToken=t2")
        ? json({ models: [{ name: "models/gemini-b" }] })
        : json({ models: [{ name: "models/gemini-a" }], nextPageToken: "t2" }),
    );
    mod.setAvailabilityFetch(fetchImpl as unknown as typeof fetch);

    await mod.refreshAvailableModels("gemini");

    expect(mod.peekAvailableModelIds("gemini")).toEqual(new Set(["gemini-a", "gemini-b"]));
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("m-key");
  });

  it("stays null and never throws when the fetch fails, logging once", async () => {
    const mod = await fresh();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mod.setAvailabilityFetch((async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch);

    await expect(mod.refreshAvailableModels("groq")).resolves.toBeUndefined();
    await expect(mod.refreshAvailableModels("groq")).resolves.toBeUndefined();

    expect(mod.peekAvailableModelIds("groq")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0][0] as string).event).toBe("provider_availability_failed");
  });

  it("skips entirely when the provider key is missing", async () => {
    const mod = await fresh();
    vi.stubEnv("GROQ_API_KEY", "");
    const fetchImpl = vi.fn();
    mod.setAvailabilityFetch(fetchImpl as unknown as typeof fetch);

    expect(mod.peekAvailableModelIds("groq")).toBeNull();
    await mod.refreshAvailableModels("groq");

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
