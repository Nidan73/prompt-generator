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
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  LIVE FREE-TIER CAPACITY (verified from API keys 2026-05-07)       │
 * │                                                                    │
 * │  Gemini:      1500 RPD × 6 models  = ~9000 requests/day           │
 * │  Groq:        100k TPD × 5 models  = ~500k tokens/day             │
 * │  OpenRouter:  ~200 RPD × 5 models  = ~1000 requests/day           │
 * │                                                                    │
 * │  GENERATE pool: 14 models → each model gets ~7% of traffic        │
 * │  CLARIFY pool:  10 models → each model gets ~10% of traffic       │
 * │  REFINE pool:   10 models → each model gets ~10% of traffic       │
 * └──────────────────────────────────────────────────────────────────────┘
 */

export type ProviderConfig = {
  name: string;
  url: string;
  model: string;
  apiKey: string | undefined;
};

// ─── Endpoint Constants ────────────────────────────────────────────────────────

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// ─── GENERATE Pool (needs smart models for complex JSON + switchboard output) ──
// All models here verified to support response_format: { type: "json_object" }
// via their OpenAI-compatible endpoints.

export const GENERATE_POOL: ProviderConfig[] = [
  // ── Gemini (1500 RPD each, per-model independent limits) ──
  {
    name: "Gemini 2.5 Flash",
    url: GEMINI_URL,
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini 2.0 Flash",
    url: GEMINI_URL,
    model: "gemini-2.0-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini 2.0 Flash Lite",
    url: GEMINI_URL,
    model: "gemini-2.0-flash-lite",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini 2.5 Flash Lite",
    url: GEMINI_URL,
    model: "gemini-2.5-flash-lite",
    apiKey: process.env.GEMINI_API_KEY,
  },
  // ── Groq (100k TPD each, per-model independent limits) ──
  {
    name: "Groq Llama 3.3 70B",
    url: GROQ_URL,
    model: "llama-3.3-70b-versatile",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq Llama 4 Scout",
    url: GROQ_URL,
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq Qwen3 32B",
    url: GROQ_URL,
    model: "qwen/qwen3-32b",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq GPT-OSS 120B",
    url: GROQ_URL,
    model: "openai/gpt-oss-120b",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq Llama 3.1 8B",
    url: GROQ_URL,
    model: "llama-3.1-8b-instant",
    apiKey: process.env.GROQ_API_KEY,
  },
  // ── OpenRouter (free-tier, ~200 RPD each) ──
  {
    name: "OR Gemini 2.5 Flash",
    url: OPENROUTER_URL,
    model: "google/gemini-2.5-flash:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    name: "OR GPT-OSS 120B",
    url: OPENROUTER_URL,
    model: "openai/gpt-oss-120b:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    name: "OR Llama 3.3 70B",
    url: OPENROUTER_URL,
    model: "meta-llama/llama-3.3-70b-instruct:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    name: "OR Gemma 4 31B",
    url: OPENROUTER_URL,
    model: "google/gemma-4-31b-it:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    name: "OR Qwen3 Coder",
    url: OPENROUTER_URL,
    model: "qwen/qwen3-coder:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
];

// ─── CLARIFY Pool (lightweight, speed-first for guided questions) ──────────────
// Prioritizes fast response times. Smaller/lite models preferred.

export const CLARIFY_POOL: ProviderConfig[] = [
  // ── Gemini Lite & Flash (ultra-fast, 1500 RPD each) ──
  {
    name: "Gemini 2.0 Flash Lite",
    url: GEMINI_URL,
    model: "gemini-2.0-flash-lite",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini 2.5 Flash Lite",
    url: GEMINI_URL,
    model: "gemini-2.5-flash-lite",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini 2.0 Flash",
    url: GEMINI_URL,
    model: "gemini-2.0-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  // ── Groq (blazing fast inference, 100k TPD each) ──
  {
    name: "Groq Llama 3.1 8B",
    url: GROQ_URL,
    model: "llama-3.1-8b-instant",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq Llama 4 Scout",
    url: GROQ_URL,
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq GPT-OSS 20B",
    url: GROQ_URL,
    model: "openai/gpt-oss-20b",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq Qwen3 32B",
    url: GROQ_URL,
    model: "qwen/qwen3-32b",
    apiKey: process.env.GROQ_API_KEY,
  },
  // ── OpenRouter (free-tier fallback) ──
  {
    name: "OR Gemma 4 26B",
    url: OPENROUTER_URL,
    model: "google/gemma-4-26b-a4b-it:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    name: "OR GPT-OSS 20B",
    url: OPENROUTER_URL,
    model: "openai/gpt-oss-20b:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    name: "OR Llama 3.2 3B",
    url: OPENROUTER_URL,
    model: "meta-llama/llama-3.2-3b-instruct:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
];

// ─── REFINE Pool (needs good instruction-following for structural edits) ───────
// Must preserve XML tags, AIDA headers, and other frameworks during edits.

export const REFINE_POOL: ProviderConfig[] = [
  // ── Gemini (best instruction-following, 1500 RPD each) ──
  {
    name: "Gemini 2.5 Flash",
    url: GEMINI_URL,
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini 2.0 Flash",
    url: GEMINI_URL,
    model: "gemini-2.0-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini 2.5 Flash Lite",
    url: GEMINI_URL,
    model: "gemini-2.5-flash-lite",
    apiKey: process.env.GEMINI_API_KEY,
  },
  // ── Groq (fast + smart, 100k TPD each) ──
  {
    name: "Groq Llama 3.3 70B",
    url: GROQ_URL,
    model: "llama-3.3-70b-versatile",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq Qwen3 32B",
    url: GROQ_URL,
    model: "qwen/qwen3-32b",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq GPT-OSS 120B",
    url: GROQ_URL,
    model: "openai/gpt-oss-120b",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq Llama 3.1 8B",
    url: GROQ_URL,
    model: "llama-3.1-8b-instant",
    apiKey: process.env.GROQ_API_KEY,
  },
  // ── OpenRouter (free-tier fallback) ──
  {
    name: "OR Gemini 2.5 Flash",
    url: OPENROUTER_URL,
    model: "google/gemini-2.5-flash:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    name: "OR Llama 3.3 70B",
    url: OPENROUTER_URL,
    model: "meta-llama/llama-3.3-70b-instruct:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    name: "OR Gemma 4 31B",
    url: OPENROUTER_URL,
    model: "google/gemma-4-31b-it:free",
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
