/**
 * Platform registry: verified consumer chat URLs and recommendation resolution.
 * Client-safe (no fetching), so the browser can import it without pulling in
 * the server-only model landscape.
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
  { id: "groq",        name: "Groq",                  url: "https://chat.groq.com",         tiers: ["open_source", "freemium"] },
  { id: "grok",        name: "Grok",                  url: "https://grok.com",              tiers: ["freemium", "premium"] },
  { id: "huggingface", name: "HuggingFace Chat",      url: "https://huggingface.co/chat",   tiers: ["open_source"] },
  { id: "lmsys",       name: "LMSYS Chatbot Arena",   url: "https://lmarena.ai",            tiers: ["open_source", "freemium"] },
  { id: "mistral",     name: "Mistral Le Chat",       url: "https://chat.mistral.ai",       tiers: ["open_source", "freemium"] },
  { id: "perplexity",  name: "Perplexity",            url: "https://perplexity.ai",         tiers: ["freemium", "premium"] },
  { id: "poe",         name: "Poe",                   url: "https://poe.com",               tiers: ["freemium"] },
];

// ─── Registry Helpers ──────────────────────────────────────────────────────────

/** Build a compact registry list for the system prompt. */
export function buildRegistryBlock(): string {
  return PLATFORM_REGISTRY.map(
    (p) => `[${p.id}] ${p.name}:${p.tiers.join("/")}`,
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

    const isPlatformValidForTier = platform && platform.tiers.includes(tier);

    if (platform && isPlatformValidForTier && pick.model_name?.trim()) {
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
