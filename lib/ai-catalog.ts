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
  // Image generation / image-focused variants, not text chat
  "nano banana", "image gen", "image 2", "image preview",
  // API-only variants, not available in consumer chat UIs
  "custom tools", "batch", "realtime",
  // Infrastructure duplicates
  "nitro",
];

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

NOTE: Many of the platforms above (ChatGPT, Gemini, Grok) have built-in image generation. For image tasks, route to those same platforms, not to standalone image tools.
IMPORTANT: Do NOT recommend older versions when newer ones exist above.`;

// ─── Live Model Landscape ──────────────────────────────────────────────────────

export type OpenRouterModel = {
  id?: string;
  name?: string;
  created?: number;
};

// Three per vendor so a flagship is not crowded out by newer small variants.
const MODELS_PER_VENDOR = 3;

/** Pure: turn an OpenRouter catalogue into the landscape text, or null if nothing matches. */
export function buildLandscapeFromCatalogue(models: OpenRouterModel[]): string | null {
  let landscape = "";

  for (const provider of PROVIDER_MAP) {
    const matches = models
      .filter((m) => {
        const id = (m.id || "").toLowerCase();
        const name = (m.name || "").toLowerCase();

        if (!id.startsWith(provider.prefix)) return false;
        if (NOISE_FILTERS.some((noise) => name.includes(noise))) return false;
        // Free-tier duplicates of paid models
        if (id.endsWith(":free")) return false;

        return true;
      })
      .sort((a, b) => (b.created || 0) - (a.created || 0))
      .slice(0, MODELS_PER_VENDOR)
      .map((m) => {
        // "OpenAI: GPT-5.5" becomes "GPT-5.5"
        const name = m.name || m.id || "";
        const colonIndex = name.indexOf(": ");
        return colonIndex > -1 ? name.slice(colonIndex + 2) : name;
      });

    if (matches.length > 0) {
      landscape += `- ${provider.label}: ${matches.join(", ")} → use platform [${provider.platformId}]\n`;
    }
  }

  if (!landscape) return null;

  return landscape + `\nNOTE: Many platforms above (ChatGPT, Gemini, Grok) have built-in image generation. For image tasks, route to those same platforms, not to standalone image tools.
IMPORTANT: The list above shows the latest released models. Do NOT recommend older versions. Use the platform ID in brackets [like_this] for your routing picks.`;
}

type LandscapeCache = {
  value: string;
  source: "live" | "fallback";
  fetchedAt: number;
  expiresAt: number;
};

const LANDSCAPE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let landscapeCache: LandscapeCache | null = null;
let landscapeInFlight: Promise<LandscapeCache> | null = null;

function compactLandscape(landscape: string): string {
  return landscape
    .replace("CURRENT MODEL LANDSCAPE (live data, updated daily):\n", "")
    .replace("CURRENT MODEL LANDSCAPE:\n", "")
    .replace(/^- /gm, "")
    .replace(/\s+use platform\s+/g, " ")
    .replace(/\nNOTE:[\s\S]*$/m, "\nImage tasks: prefer ChatGPT/Gemini/Grok. Prefer newer models.")
    .trim();
}

async function fetchModelLandscape(): Promise<LandscapeCache> {
  const now = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: controller.signal,
      next: { revalidate: 86400 },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return {
        value: compactLandscape(STATIC_FALLBACK_LANDSCAPE),
        source: "fallback",
        fetchedAt: now,
        expiresAt: now + LANDSCAPE_CACHE_TTL_MS,
      };
    }

    const data = (await res.json()) as { data?: OpenRouterModel[] };
    const models = data.data;

    if (!Array.isArray(models) || models.length === 0) {
      return {
        value: compactLandscape(STATIC_FALLBACK_LANDSCAPE),
        source: "fallback",
        fetchedAt: now,
        expiresAt: now + LANDSCAPE_CACHE_TTL_MS,
      };
    }

    const landscape = buildLandscapeFromCatalogue(models);

    if (!landscape) {
      return {
        value: compactLandscape(STATIC_FALLBACK_LANDSCAPE),
        source: "fallback",
        fetchedAt: now,
        expiresAt: now + LANDSCAPE_CACHE_TTL_MS,
      };
    }

    return {
      value: compactLandscape(landscape),
      source: "live",
      fetchedAt: now,
      expiresAt: now + LANDSCAPE_CACHE_TTL_MS,
    };
  } catch {
    return {
      value: compactLandscape(STATIC_FALLBACK_LANDSCAPE),
      source: "fallback",
      fetchedAt: now,
      expiresAt: now + LANDSCAPE_CACHE_TTL_MS,
    };
  }
}

/**
 * Fetch the latest model releases from OpenRouter, filter noise,
 * and map each provider to its platform_id for the LLM.
 *
 * A short in-memory cache avoids paying this fetch on every generation request.
 * The fetch itself still uses Next/Vercel revalidation as a second cache layer.
 */
export async function getLiveModelLandscape(): Promise<string> {
  const now = Date.now();

  if (landscapeCache && landscapeCache.expiresAt > now) {
    return landscapeCache.value;
  }

  if (landscapeInFlight) {
    return (await landscapeInFlight).value;
  }

  landscapeInFlight = fetchModelLandscape();

  try {
    landscapeCache = await landscapeInFlight;
    return landscapeCache.value;
  } finally {
    landscapeInFlight = null;
  }
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
