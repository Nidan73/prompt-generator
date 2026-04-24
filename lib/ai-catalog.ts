/**
 * AI Platform Registry & Live Model Landscape
 *
 * Two layers:
 *   1. PLATFORM_REGISTRY — verified consumer chat URLs (static, stable)
 *   2. getLiveModelLandscape() — fetches model release data from OpenRouter
 *      daily, maps each provider to its platform_id, filters noise, and
 *      falls back to a static snapshot if the API is unreachable.
 *
 * The LLM dynamically decides which model is best for the task.
 * This file guarantees valid URLs and fresh model data.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PlatformTier = "open_source" | "freemium" | "premium";

export type Platform = {
  id: string;
  name: string;
  url: string;
  tiers: PlatformTier[];
};

export type ResolvedRecommendation = {
  model_name: string;
  platform_url: string;
  reasoning: string;
};

// ─── Platform Registry ─────────────────────────────────────────────────────────

export const PLATFORM_REGISTRY: Platform[] = [
  { id: "chatgpt",     name: "ChatGPT",              url: "https://chatgpt.com",           tiers: ["freemium", "premium"] },
  { id: "claude",      name: "Claude",                url: "https://claude.ai",             tiers: ["freemium", "premium"] },
  { id: "copilot",     name: "Microsoft Copilot",     url: "https://copilot.microsoft.com", tiers: ["freemium"] },
  { id: "deepseek",    name: "DeepSeek",              url: "https://chat.deepseek.com",     tiers: ["open_source", "freemium"] },
  { id: "gemini",      name: "Google Gemini",         url: "https://gemini.google.com",     tiers: ["freemium", "premium"] },
  { id: "groq",        name: "Groq",                  url: "https://groq.com",              tiers: ["open_source", "freemium"] },
  { id: "grok",        name: "Grok",                  url: "https://grok.com",              tiers: ["freemium", "premium"] },
  { id: "huggingface", name: "HuggingFace Chat",      url: "https://huggingface.co/chat",   tiers: ["open_source"] },
  { id: "lmsys",       name: "LMSYS Chatbot Arena",   url: "https://chat.lmsys.org",        tiers: ["open_source", "freemium"] },
  { id: "mistral",     name: "Mistral Le Chat",       url: "https://chat.mistral.ai",       tiers: ["open_source", "freemium"] },
  { id: "perplexity",  name: "Perplexity",            url: "https://perplexity.ai",         tiers: ["freemium", "premium"] },
  { id: "poe",         name: "Poe",                   url: "https://poe.com",               tiers: ["freemium"] },
];

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
// "preview" is intentionally NOT here — Google/others use it as their
// standard release channel for the latest models.
const NOISE_FILTERS = [
  // Safety & moderation models — not for general chat
  "guard", "moderation", "shield",
  // Non-text modalities — not useful for prompt routing
  "embedding", "tts", "whisper", "audio", "speech",
  // Image generation / image-focused variants — not text chat
  "nano banana", "image gen", "image 2", "image preview", "dall-e",
  // API-only variants — not available in consumer chat UIs
  "custom tools", "batch", "realtime",
  // Infrastructure duplicates
  "nitro",
];

// ─── Static Fallback Landscape ─────────────────────────────────────────────────
// Used when OpenRouter is completely unreachable. Updated periodically.
// This is a safety net, not the primary source.

const STATIC_FALLBACK_LANDSCAPE = `CURRENT MODEL LANDSCAPE (static fallback — may be slightly outdated):
- OpenAI GPT: GPT-5.5 Pro, GPT-5.5, GPT-5.4 Nano → use platform [chatgpt]
- OpenAI Reasoning: o3 Deep Research, o4 Mini Deep Research, o3 Pro → use platform [chatgpt]
- Anthropic Claude: Claude Opus 4.7, Claude Opus 4.6, Claude Sonnet 4.6 → use platform [claude]
- Google Gemini: Gemini 3.1 Flash Lite Preview, Gemini 3.1 Pro Preview, Gemini 2.5 Flash → use platform [gemini]
- Meta Llama: Llama 4 Maverick, Llama 4 Scout, Llama 3.3 70B Instruct → use platform [groq] or [huggingface]
- DeepSeek: DeepSeek V4 Pro, DeepSeek V4 Flash, DeepSeek V3.2 Speciale → use platform [deepseek]
- xAI Grok: Grok 4.20 Multi-Agent, Grok 4.20, Grok 4.1 Fast → use platform [grok]
- Mistral: Mistral Small 4, Mistral Small Creative, Devstral 2 → use platform [mistral]
- Qwen: Qwen3.6 Plus, Qwen3.5-9B → use platform [huggingface]

IMPORTANT: Do NOT recommend older versions when newer ones exist above.`;

// ─── Live Model Landscape ──────────────────────────────────────────────────────

type OpenRouterModel = {
  id?: string;
  name?: string;
  created?: number;
};

/**
 * Fetch the latest model releases from OpenRouter, filter noise,
 * and map each provider to its platform_id for the LLM.
 *
 * Cached for 24 hours by Next.js. Falls back to the static
 * landscape if the API is unreachable.
 */
export async function getLiveModelLandscape(): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: controller.signal,
      next: { revalidate: 86400 },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return STATIC_FALLBACK_LANDSCAPE;
    }

    const data = (await res.json()) as { data?: OpenRouterModel[] };
    const models = data.data;

    if (!Array.isArray(models) || models.length === 0) {
      return STATIC_FALLBACK_LANDSCAPE;
    }

    let landscape = "CURRENT MODEL LANDSCAPE (live data, updated daily):\n";

    for (const provider of PROVIDER_MAP) {
      const matches = models
        .filter((m) => {
          const id = (m.id || "").toLowerCase();
          const name = (m.name || "").toLowerCase();

          // Must match the provider prefix
          if (!id.startsWith(provider.prefix)) return false;

          // Filter out non-consumer noise
          if (NOISE_FILTERS.some((noise) => name.includes(noise))) return false;

          // Filter out free-tier duplicates (`:free` suffix)
          if (id.endsWith(":free")) return false;

          return true;
        })
        .sort((a, b) => (b.created || 0) - (a.created || 0))
        .slice(0, 3)
        .map((m) => {
          // Strip provider prefix from name for cleaner output
          // "OpenAI: GPT-5.5" → "GPT-5.5"
          const name = m.name || m.id || "";
          const colonIndex = name.indexOf(": ");
          return colonIndex > -1 ? name.slice(colonIndex + 2) : name;
        });

      if (matches.length > 0) {
        landscape += `- ${provider.label}: ${matches.join(", ")} → use platform [${provider.platformId}]\n`;
      }
    }

    landscape +=
      "\nIMPORTANT: The list above shows the latest released models. Do NOT recommend older versions. Use the platform ID in brackets [like_this] for your routing picks.";

    return landscape;
  } catch {
    return STATIC_FALLBACK_LANDSCAPE;
  }
}

// ─── Registry Helpers ──────────────────────────────────────────────────────────

/** Build a compact registry list for the system prompt. */
export function buildRegistryBlock(): string {
  return PLATFORM_REGISTRY.map(
    (p) => `  [${p.id}] ${p.name} (${p.tiers.join(", ")})`,
  ).join("\n");
}

/**
 * Look up a platform by ID with fuzzy matching.
 * Handles common LLM mistakes: spaces, underscores, hyphens, casing,
 * and known aliases (e.g., "openai" → "chatgpt").
 */
export function findPlatform(id: string): Platform | undefined {
  const normalized = id.trim().toLowerCase().replace(/[\s\-_]+/g, "");

  // Direct match first
  const direct = PLATFORM_REGISTRY.find(
    (p) => p.id === normalized || p.id.replace(/[\s\-_]+/g, "") === normalized,
  );
  if (direct) return direct;

  // Alias matching for common LLM mistakes
  const aliases: Record<string, string> = {
    openai: "chatgpt",
    gpt: "chatgpt",
    anthropic: "claude",
    google: "gemini",
    meta: "groq",
    llama: "groq",
    xai: "grok",
    bing: "copilot",
    microsoft: "copilot",
    hf: "huggingface",
    lechat: "mistral",
  };

  const aliasMatch = aliases[normalized];
  if (aliasMatch) {
    return PLATFORM_REGISTRY.find((p) => p.id === aliasMatch);
  }

  // Substring match as last resort
  return PLATFORM_REGISTRY.find(
    (p) => normalized.includes(p.id) || p.id.includes(normalized),
  );
}

// ─── Recommendation Resolution ─────────────────────────────────────────────────

/**
 * Resolve LLM picks into final recommendations.
 *   - LLM provides: platform_id + model_name + reasoning (all dynamic)
 *   - Registry provides: verified URL (static)
 *   - Fuzzy matching handles LLM typos/aliases
 */
export function resolveRecommendations(
  picks: Record<string, { platform_id: string; model_name: string; reasoning: string }>,
): Record<PlatformTier, ResolvedRecommendation> {
  const tiers: PlatformTier[] = ["open_source", "freemium", "premium"];
  const result = {} as Record<PlatformTier, ResolvedRecommendation>;

  for (const tier of tiers) {
    const pick = picks[tier];
    const platform = pick?.platform_id ? findPlatform(pick.platform_id) : undefined;

    if (platform && pick.model_name?.trim()) {
      result[tier] = {
        model_name: pick.model_name.trim(),
        platform_url: platform.url,
        reasoning: pick.reasoning?.trim() || "Recommended for this task.",
      };
    } else {
      // Deterministic fallback: first registry entry that matches this tier
      const fallback = PLATFORM_REGISTRY.find((p) => p.tiers.includes(tier));
      result[tier] = fallback
        ? { model_name: fallback.name, platform_url: fallback.url, reasoning: "General-purpose recommendation." }
        : { model_name: "AI Platform", platform_url: "https://google.com/", reasoning: "Fallback recommendation." };
    }
  }

  return result;
}
