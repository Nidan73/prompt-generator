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
 * │  Groq:        100k TPD × 5 models  = ~500k tokens/day  (FASTEST)  │
 * │  Gemini:      1500 RPD × 4 models  = ~6000 requests/day           │
 * │  OpenRouter:  ~200 RPD × 3 models  = ~600 requests/day            │
 * │                                                                    │
 * │  Strategy: Groq models FIRST for speed, Gemini as reliable backup, │
 * │  OpenRouter as last-resort safety net.                             │
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
// Strategy: Groq first (fastest inference), then Gemini (highest quota),
// then OpenRouter (free safety net). All verified live 2026-05-07.

export const GENERATE_POOL: ProviderConfig[] = [
  // ── Groq (100k TPD each, ~800 tok/s — FASTEST provider) ──
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
    name: "Groq Llama 4 Scout",
    url: GROQ_URL,
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq Llama 3.1 8B",
    url: GROQ_URL,
    model: "llama-3.1-8b-instant",
    apiKey: process.env.GROQ_API_KEY,
  },
  // ── Gemini (1500 RPD each — reliable high-quota backup) ──
  {
    name: "Gemini 2.5 Flash",
    url: GEMINI_URL,
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini 2.5 Flash Lite",
    url: GEMINI_URL,
    model: "gemini-2.5-flash-lite",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini 3.1 Pro",
    url: GEMINI_URL,
    model: "gemini-3.1-pro-preview",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini 2.0 Flash",
    url: GEMINI_URL,
    model: "gemini-2.0-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  // ── OpenRouter (free safety net) ──
  {
    name: "OR GPT-OSS 120B",
    url: OPENROUTER_URL,
    model: "openai/gpt-oss-120b:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    name: "OR GPT-OSS 20B",
    url: OPENROUTER_URL,
    model: "openai/gpt-oss-20b:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    name: "OR Nemotron 120B",
    url: OPENROUTER_URL,
    model: "nvidia/nemotron-3-super-120b-a12b:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
];

// ─── CLARIFY Pool (lightweight, speed-first for guided questions) ──────────────
// Prioritizes fast response times. Smaller models preferred.

export const CLARIFY_POOL: ProviderConfig[] = [
  // ── Groq (blazing fast, 100k TPD each) ──
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
    name: "Groq Qwen3 32B",
    url: GROQ_URL,
    model: "qwen/qwen3-32b",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "Groq GPT-OSS 20B",
    url: GROQ_URL,
    model: "openai/gpt-oss-20b",
    apiKey: process.env.GROQ_API_KEY,
  },
  // ── Gemini (ultra-fast lite models, 1500 RPD each) ──
  {
    name: "Gemini 2.5 Flash Lite",
    url: GEMINI_URL,
    model: "gemini-2.5-flash-lite",
    apiKey: process.env.GEMINI_API_KEY,
  },
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
  // ── OpenRouter (free-tier fallback) ──
  {
    name: "OR GPT-OSS 20B",
    url: OPENROUTER_URL,
    model: "openai/gpt-oss-20b:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
];

// ─── REFINE Pool (needs good instruction-following for structural edits) ───────
// Must preserve XML tags, AIDA headers, and other frameworks during edits.

export const REFINE_POOL: ProviderConfig[] = [
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
  // ── Gemini (best instruction-following, 1500 RPD each) ──
  {
    name: "Gemini 2.5 Flash",
    url: GEMINI_URL,
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini 2.5 Flash Lite",
    url: GEMINI_URL,
    model: "gemini-2.5-flash-lite",
    apiKey: process.env.GEMINI_API_KEY,
  },
  {
    name: "Gemini 3.1 Pro",
    url: GEMINI_URL,
    model: "gemini-3.1-pro-preview",
    apiKey: process.env.GEMINI_API_KEY,
  },
  // ── OpenRouter (free-tier fallback) ──
  {
    name: "OR GPT-OSS 120B",
    url: OPENROUTER_URL,
    model: "openai/gpt-oss-120b:free",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    name: "OR Nemotron 120B",
    url: OPENROUTER_URL,
    model: "nvidia/nemotron-3-super-120b-a12b:free",
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
