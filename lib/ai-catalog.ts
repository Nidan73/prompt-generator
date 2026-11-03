/**
 * Live Model Landscape (server-only)
 *
 * The platform registry lives in platform-registry.ts so client code can use
 * it without this fetching code; it is re-exported here for server callers.
 *
 * Two layers:
 *   1. PLATFORM_REGISTRY, verified consumer chat URLs (static, stable)
 *   2. getLiveModelLandscape(), fetches model release data from OpenRouter
 *      daily, maps each provider to its platform_id, filters noise, and
 *      falls back to a static snapshot if the API is unreachable.
 *
 * The LLM dynamically decides which model is best for the task.
 * This file guarantees valid URLs and fresh model data.
 */

import type { Redis } from "@upstash/redis";
import { PLATFORM_REGISTRY } from "./platform-registry";
import { redisFromEnvOrNull } from "./redis-env";

export {
  PLATFORM_REGISTRY,
  buildRegistryBlock,
  findPlatform,
  resolveRecommendations,
} from "./platform-registry";
export type { PlatformTier, Platform, ResolvedRecommendation } from "./platform-registry";

// ─── Provider → Platform Mapping ───────────────────────────────────────────────
// Maps OpenRouter provider prefixes to our platform IDs + human labels.
// This is the bridge between dynamic model data and our verified URL registry.

const PROVIDER_MAP = [
  { prefix: "openai/gpt",        label: "OpenAI GPT",       platformId: "chatgpt" },
  { prefix: "openai/o",          label: "OpenAI Reasoning",  platformId: "chatgpt" },
  { prefix: "anthropic/claude",  label: "Anthropic Claude",  platformId: "claude" },
  { prefix: "google/gemini",     label: "Google Gemini",     platformId: "gemini" },
  { prefix: "meta-llama/llama",  label: "Meta Llama",        platformId: "groq" },
  { prefix: "deepseek/deepseek", label: "DeepSeek",          platformId: "deepseek" },
  { prefix: "x-ai/grok",        label: "xAI Grok",          platformId: "grok" },
  { prefix: "mistralai/",        label: "Mistral",           platformId: "mistral" },
  { prefix: "qwen/qwen",        label: "Qwen",              platformId: "huggingface" },
] as const;

// Words/patterns that indicate genuinely non-consumer or non-chat models.
// "preview" is intentionally NOT here, Google/others use it as their
// standard release channel for the latest models.
const NOISE_FILTERS = [
  // Safety & moderation models, not for general chat
  "guard", "moderation", "shield",
  // Non-text modalities, not useful for prompt routing
  "embedding", "tts", "whisper", "audio", "speech",
  // Image variants the modality filter does not already catch
  "image gen", "image preview",
  // API-only variants, not available in consumer chat UIs
  "custom tools", "batch", "realtime",
  // Infrastructure duplicates
  "nitro",
  // (exp / experimental are matched as whole words in isNoisy)
];

const EXPERIMENTAL_RE = /\b(exp|experimental)\b/i;

function isNoisy(name: string): boolean {
  const lower = name.toLowerCase();
  return NOISE_FILTERS.some((noise) => lower.includes(noise)) || EXPERIMENTAL_RE.test(name);
}

// ─── Static Fallback Landscape ─────────────────────────────────────────────────
// Used when OpenRouter is completely unreachable. Refreshed 2026-11-04 from the public OpenRouter catalogue via buildLandscapeFromCatalogue.
// This is a safety net, not the primary source.

const STATIC_FALLBACK_LANDSCAPE = `CURRENT MODEL LANDSCAPE:
- OpenAI GPT: GPT-6.1 Terra Pro, GPT-6.1 Terra, GPT-6.1 Sol Pro → use platform [chatgpt]
- OpenAI Reasoning: o3 Pro, o3 → use platform [chatgpt]
- Anthropic Claude: Claude Haiku 5.5, Claude Sonnet 5.5, Claude Opus 5.5 → use platform [claude]
- Google Gemini: Gemini 4 Argon, Gemini 3.8 Flash, Gemini 3.7 Flash → use platform [gemini]
- Meta Llama: Llama 4 Maverick, Llama 4 Scout, Llama 3.3 70B Instruct → use platform [groq] or [huggingface]
- DeepSeek: DeepSeek V4.1 Flash 1017, DeepSeek V4.1 Flash, DeepSeek V4 Flash Vision Exp → use platform [deepseek]
- xAI Grok: Grok 4.7, Grok 4.6, Grok 4.5 → use platform [grok]
- Mistral: Mistral Large 4, Mistral Medium 3.5, Mistral Small 4 → use platform [mistral]
- Qwen: Qwen3.8 Max Prime, Qwen3.8 Omni Flash, Qwen3.8 Max (0902) → use platform [huggingface]

IMPORTANT: Do NOT recommend older versions when newer ones exist above.`;

// ─── Live Model Landscape ──────────────────────────────────────────────────────

export type OpenRouterModel = {
  id?: string;
  name?: string;
  created?: number;
  hugging_face_id?: string | null;
  architecture?: { output_modalities?: string[] };
};

// Three per vendor so a flagship is not crowded out by newer small variants.
const MODELS_PER_VENDOR = 3;

function isImageOutput(m: OpenRouterModel): boolean {
  return Boolean(m.architecture?.output_modalities?.includes("image"));
}

function isOpenWeight(m: OpenRouterModel): boolean {
  return Boolean(m.hugging_face_id && m.hugging_face_id.trim());
}

/** "OpenAI: GPT-5.5" becomes "GPT-5.5" */
function shortName(m: OpenRouterModel): string {
  const name = m.name || m.id || "";
  const colonIndex = name.indexOf(": ");
  return colonIndex > -1 ? name.slice(colonIndex + 2) : name;
}

const byNewest = (a: OpenRouterModel, b: OpenRouterModel) => (b.created || 0) - (a.created || 0);

/** Pure: turn an OpenRouter catalogue into the landscape text, or null if nothing matches. */
export function buildLandscapeFromCatalogue(models: OpenRouterModel[]): string | null {
  let landscape = "";

  for (const provider of PROVIDER_MAP) {
    const candidates = models
      .filter((m) => {
        const id = (m.id || "").toLowerCase();

        if (!id.startsWith(provider.prefix)) return false;
        if (isNoisy(m.name || "")) return false;
        // Image-output models are listed separately
        if (isImageOutput(m)) return false;
        // Free-tier duplicates of paid models
        if (id.endsWith(":free")) return false;

        return true;
      })
      .sort(byNewest);

    const selected = candidates.slice(0, MODELS_PER_VENDOR);

    // Open-source picks need a real open-weight model to name, so surface one
    // when the newest few are all closed.
    const platform = PLATFORM_REGISTRY.find((p) => p.id === provider.platformId);
    if (platform?.tiers.includes("open_source") && !selected.some(isOpenWeight)) {
      const openWeight = candidates.slice(MODELS_PER_VENDOR).find(isOpenWeight);
      if (openWeight) selected.push(openWeight);
    }

    if (selected.length > 0) {
      const names = selected.map((m) => shortName(m) + (isOpenWeight(m) ? " (open-weight)" : ""));
      landscape += `- ${provider.label}: ${names.join(", ")} → use platform [${provider.platformId}]\n`;
    }
  }

  if (!landscape) return null;

  return landscape + `\nIMPORTANT: The list above shows the latest released models. Do NOT recommend older versions. Use the platform ID in brackets [like_this] for your routing picks.`;
}

const IMAGE_MODELS_PER_VENDOR = 3;

/** Pure: image-output models from the catalogue, grouped by vendor, or null if none. */
export function buildImageLandscapeFromCatalogue(models: OpenRouterModel[]): string | null {
  const lines: string[] = [];

  for (const provider of PROVIDER_MAP) {
    const names = models
      .filter((m) => {
        const id = (m.id || "").toLowerCase();
        if (id.startsWith("openrouter/") || id.endsWith(":free")) return false;
        if (!isImageOutput(m)) return false;
        if ((m.name || "").toLowerCase().includes("preview")) return false;
        // First matching vendor wins, mirroring how the text list groups ids
        return PROVIDER_MAP.find((p) => id.startsWith(p.prefix)) === provider;
      })
      .sort(byNewest)
      .slice(0, IMAGE_MODELS_PER_VENDOR)
      .map(shortName);

    if (names.length > 0) {
      lines.push(`${provider.label}: ${names.join(", ")} → [${provider.platformId}]`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

export type ModelLandscape = { models: string; imageModels: string };

type LandscapeCache = {
  value: ModelLandscape;
  source: "live" | "snapshot" | "fallback";
  fetchedAt: number;
  expiresAt: number;
};

const LANDSCAPE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// A non-live result is retried sooner so recovery is not delayed by hours
const LANDSCAPE_RETRY_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_KEY = "btq:model-landscape:last-good";
const SNAPSHOT_TTL_SECONDS = 7 * 24 * 60 * 60;
const NO_IMAGE_MODELS = "none listed";
const SNAPSHOT_READ_TIMEOUT_MS = 1000;
// A corrupt or oversized snapshot must never become prompt text.
const SNAPSHOT_MAX_CHARS = 20000;

let landscapeCache: LandscapeCache | null = null;
let landscapeInFlight: Promise<LandscapeCache> | null = null;
let snapshotRedis: Redis | null | undefined;

function getSnapshotRedis(): Redis | null {
  if (snapshotRedis !== undefined) return snapshotRedis;

  try {
    snapshotRedis = redisFromEnvOrNull();
  } catch {
    snapshotRedis = null;
  }

  return snapshotRedis;
}

/** Fire and forget: the snapshot is a safety net, never worth failing a request. */
function saveSnapshot(value: ModelLandscape, fetchedAt: number): void {
  try {
    const redis = getSnapshotRedis();
    if (!redis) return;
    void Promise.resolve(
      redis.set(SNAPSHOT_KEY, JSON.stringify({ ...value, fetchedAt }), { ex: SNAPSHOT_TTL_SECONDS }),
    ).catch(() => {});
  } catch {
    // ignored
  }
}

async function loadSnapshot(): Promise<{ value: ModelLandscape; fetchedAt: number } | null> {
  try {
    const redis = getSnapshotRedis();
    if (!redis) return null;
    // Bounded: a slow Redis must not hold up the request that needs the fallback.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raw = await Promise.race([
      redis.get<unknown>(SNAPSHOT_KEY),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SNAPSHOT_READ_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (raw === null || raw === undefined) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as ModelLandscape).models === "string" &&
      typeof (parsed as ModelLandscape).imageModels === "string" &&
      (parsed as ModelLandscape).models.trim() !== "" &&
      (parsed as ModelLandscape).models.length <= SNAPSHOT_MAX_CHARS &&
      (parsed as ModelLandscape).imageModels.length <= SNAPSHOT_MAX_CHARS
    ) {
      const p = parsed as ModelLandscape & { fetchedAt?: number };
      return {
        value: { models: p.models, imageModels: p.imageModels },
        fetchedAt: typeof p.fetchedAt === "number" ? p.fetchedAt : Date.now(),
      };
    }
  } catch {
    // fall through to the static text
  }
  return null;
}

function compactLandscape(landscape: string): string {
  return landscape
    .replace("CURRENT MODEL LANDSCAPE (live data, updated daily):\n", "")
    .replace("CURRENT MODEL LANDSCAPE:\n", "")
    .replace(/^- /gm, "")
    .replace(/\s+use platform\s+/g, " ")
    .replace(/\nIMPORTANT:[\s\S]*$/m, "\nPrefer newer models.")
    .trim();
}

async function buildLiveLandscape(): Promise<ModelLandscape | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: controller.signal,
      next: { revalidate: 86400 },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { data?: OpenRouterModel[] };
    const models = data.data;
    if (!Array.isArray(models) || models.length === 0) return null;

    const landscape = buildLandscapeFromCatalogue(models);
    if (!landscape) return null;

    return {
      models: compactLandscape(landscape),
      imageModels: buildImageLandscapeFromCatalogue(models) ?? NO_IMAGE_MODELS,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchModelLandscape(): Promise<LandscapeCache> {
  const now = Date.now();
  const live = await buildLiveLandscape();

  if (live) {
    saveSnapshot(live, now);
    return { value: live, source: "live", fetchedAt: now, expiresAt: now + LANDSCAPE_CACHE_TTL_MS };
  }

  // Newest-known data first: stale memory, then the Redis snapshot, then static text.
  if (landscapeCache && landscapeCache.source !== "fallback") {
    return { ...landscapeCache, expiresAt: now + LANDSCAPE_RETRY_TTL_MS };
  }

  const snapshot = await loadSnapshot();
  if (snapshot) {
    return {
      value: snapshot.value,
      source: "snapshot",
      fetchedAt: snapshot.fetchedAt,
      expiresAt: now + LANDSCAPE_RETRY_TTL_MS,
    };
  }

  return {
    value: { models: compactLandscape(STATIC_FALLBACK_LANDSCAPE), imageModels: NO_IMAGE_MODELS },
    source: "fallback",
    fetchedAt: now,
    expiresAt: now + LANDSCAPE_RETRY_TTL_MS,
  };
}

/**
 * Fetch the latest model releases from OpenRouter, filter noise,
 * and map each provider to its platform_id for the LLM.
 *
 * A short in-memory cache avoids paying this fetch on every generation request.
 * It is stale-while-revalidate: an expired cache is returned at once and
 * refreshed in the background, so only a true cold start waits on the network.
 * The fetch itself still uses Next/Vercel revalidation as a second cache layer,
 * and a Redis last-good snapshot covers cold starts during an OpenRouter outage.
 */
export async function getLiveModelLandscape(): Promise<ModelLandscape> {
  if (landscapeCache) {
    if (landscapeCache.expiresAt <= Date.now()) void refreshLandscape().catch(() => undefined);
    return landscapeCache.value;
  }

  return (await refreshLandscape()).value;
}

/** One refresh at a time; concurrent callers share the same promise. */
function refreshLandscape(): Promise<LandscapeCache> {
  if (!landscapeInFlight) {
    landscapeInFlight = fetchModelLandscape()
      .then((next) => {
        landscapeCache = next;
        return next;
      })
      .finally(() => {
        landscapeInFlight = null;
      });
  }
  return landscapeInFlight;
}

export function getModelLandscapeCacheState() {
  const now = Date.now();

  return {
    cached: Boolean(landscapeCache),
    source: landscapeCache?.source ?? "empty",
    ageMs: landscapeCache ? now - landscapeCache.fetchedAt : null,
    expiresInMs: landscapeCache ? Math.max(0, landscapeCache.expiresAt - now) : null,
    inFlight: Boolean(landscapeInFlight),
  };
}
