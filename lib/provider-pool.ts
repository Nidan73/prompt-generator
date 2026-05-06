/**
 * Provider Pool — Round-Robin Load Balancer
 *
 * Instead of a static fallback chain that hammers one provider until it dies,
 * this module distributes every request across ALL available models using a
 * round-robin counter. Each model has its own independent rate limit bucket
 * on every provider (Groq, Gemini, OpenRouter), so spreading load evenly
 * across N models multiplies our total free-tier capacity by N.
 *
 * If the selected model fails (429/5xx), the system automatically tries the
 * next model in the ring. The user never sees an error unless every single
 * model in the entire pool is down simultaneously.
 *
 * Free-tier capacity estimate with this pool:
 *   Groq:       ~100k TPD × 3 models  = ~300k tokens/day
 *   Gemini:     ~1500 RPD × 3 models  = ~4500 requests/day
 *   OpenRouter:  ~200 RPD × 2 models  = ~400 requests/day
 *   TOTAL:      Thousands of requests/day on purely free tiers.
 */

export type ProviderConfig = {
  name: string;
  url: string;
  model: string;
  apiKey: string | undefined;
};

// ─── GENERATE Pool (needs smart models for complex JSON output) ────────────────
// These models must reliably follow the 7-category switchboard + JSON output format.

export const GENERATE_POOL: ProviderConfig[] = [
  // Gemini models — 1500 RPD each, per-model limits
  {
    name: "Gemini (2.5 Flash)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini (2.0 Flash)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.0-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini (1.5 Flash)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-1.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  // Groq models — per-model TPD limits
  {
    name: "Groq (Llama 70B)",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq (Gemma2 9B)",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "gemma2-9b-it",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq (Llama 8B)",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.1-8b-instant",
    apiKey: process.env.GROQ_API_KEY,
  },
  // OpenRouter — free-tier models
  {
    name: "OpenRouter (Gemini Flash)",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "google/gemini-2.5-flash:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    name: "OpenRouter (Llama 70B)",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
];

// ─── CLARIFY Pool (lightweight, speed-first for guided questions) ──────────────
// These are fast, small models perfect for generating clarifying question JSON.

export const CLARIFY_POOL: ProviderConfig[] = [
  {
    name: "Gemini (2.0 Flash Lite)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.0-flash-lite",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini (2.0 Flash)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.0-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Groq (Llama 8B)",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.1-8b-instant",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq (Gemma2 9B)",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "gemma2-9b-it",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "OpenRouter (Llama 8B)",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "meta-llama/llama-3.1-8b-instruct:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
];

// ─── REFINE Pool (needs good instruction-following for prompt edits) ───────────

export const REFINE_POOL: ProviderConfig[] = [
  {
    name: "Gemini (2.5 Flash)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini (2.0 Flash)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.0-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Groq (Llama 70B)",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq (Llama 8B)",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.1-8b-instant",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "OpenRouter (Gemini Flash)",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "google/gemini-2.5-flash:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
];

// ─── Round-Robin Counter ───────────────────────────────────────────────────────
// A simple global counter per pool. Each incoming request picks the next model
// in the ring. This guarantees perfectly even distribution across all models.
// On Edge Runtime, each isolate gets its own counter, which is fine — the goal
// is to avoid hammering one model, not to achieve perfect global fairness.

const counters = new Map<string, number>();

function getNextIndex(poolName: string, poolSize: number): number {
  const current = counters.get(poolName) ?? 0;
  const next = (current + 1) % poolSize;
  counters.set(poolName, next);
  return current;
}

/**
 * Build a fallback chain starting from the round-robin position.
 * If model at index 3 is selected, the chain becomes: [3, 4, 5, 0, 1, 2]
 * This ensures every model gets tried before we give up.
 */
export function getRotatedChain(poolName: string, pool: ProviderConfig[]): ProviderConfig[] {
  // Filter out providers with no API key configured
  const available = pool.filter((p) => p.apiKey);
  if (available.length === 0) return [];

  const startIndex = getNextIndex(poolName, available.length);
  return [...available.slice(startIndex), ...available.slice(0, startIndex)];
}
