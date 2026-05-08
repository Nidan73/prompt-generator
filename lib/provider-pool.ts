import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Provider Pool — Round-Robin Load Balancer (AI SDK Streaming Version)
 *
 * Instead of a static fallback chain that hammers one provider until it dies,
 * this module distributes every request across ALL available models using a
 * round-robin counter.
 */

// ─── AI SDK Providers ──────────────────────────────────────────────────────────

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY || "missing" });
const groq = createOpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey: process.env.GROQ_API_KEY || "missing" });
const openrouter = createOpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY || "missing" });

export type ProviderConfig = {
  name: string;
  sdkModel: LanguageModel;
  hasKey: boolean;
};

// ─── GENERATE Pool (needs smart models for complex JSON + switchboard output) ──

export const GENERATE_POOL: ProviderConfig[] = [
  // ── Groq (100k TPD each, ~800 tok/s — FASTEST provider) ──
  // Generate uses streamObject, so providers must support strict JSON schema.
  { name: "Groq GPT-OSS 120B", sdkModel: groq("openai/gpt-oss-120b"), hasKey: !!process.env.GROQ_API_KEY },
  { name: "Groq GPT-OSS 20B", sdkModel: groq("openai/gpt-oss-20b"), hasKey: !!process.env.GROQ_API_KEY },
  // ── Gemini (1500 RPD each — reliable high-quota backup) ──
  { name: "Gemini 2.5 Flash", sdkModel: google("gemini-2.5-flash"), hasKey: !!process.env.GEMINI_API_KEY },
  { name: "Gemini 2.5 Flash Lite", sdkModel: google("gemini-2.5-flash-lite"), hasKey: !!process.env.GEMINI_API_KEY },
  { name: "Gemini 2.0 Flash", sdkModel: google("gemini-2.0-flash"), hasKey: !!process.env.GEMINI_API_KEY },
  // ── OpenRouter (free safety net) ──
  { name: "OR GPT-OSS 120B", sdkModel: openrouter("openai/gpt-oss-120b:free"), hasKey: !!process.env.OPENROUTER_API_KEY },
  { name: "OR GPT-OSS 20B", sdkModel: openrouter("openai/gpt-oss-20b:free"), hasKey: !!process.env.OPENROUTER_API_KEY },
];

// ─── CLARIFY Pool (lightweight, speed-first for guided questions) ──────────────

export const CLARIFY_POOL: ProviderConfig[] = [
  // ── Groq (blazing fast, 100k TPD each) ──
  { name: "Groq Llama 3.1 8B", sdkModel: groq("llama-3.1-8b-instant"), hasKey: !!process.env.GROQ_API_KEY },
  { name: "Groq Llama 4 Scout", sdkModel: groq("meta-llama/llama-4-scout-17b-16e-instruct"), hasKey: !!process.env.GROQ_API_KEY },
  { name: "Groq Qwen3 32B", sdkModel: groq("qwen/qwen3-32b"), hasKey: !!process.env.GROQ_API_KEY },
  { name: "Groq GPT-OSS 20B", sdkModel: groq("openai/gpt-oss-20b"), hasKey: !!process.env.GROQ_API_KEY },
  { name: "Groq Mixtral 8x7B", sdkModel: groq("mixtral-8x7b-32768"), hasKey: !!process.env.GROQ_API_KEY },
  { name: "Groq Gemma 2 9B", sdkModel: groq("gemma2-9b-it"), hasKey: !!process.env.GROQ_API_KEY },
  { name: "Groq Llama 3 8B", sdkModel: groq("llama3-8b-8192"), hasKey: !!process.env.GROQ_API_KEY },
  // ── Gemini (ultra-fast lite models, 1500 RPD each) ──
  { name: "Gemini 2.5 Flash Lite", sdkModel: google("gemini-2.5-flash-lite"), hasKey: !!process.env.GEMINI_API_KEY },
  { name: "Gemini 2.5 Flash", sdkModel: google("gemini-2.5-flash"), hasKey: !!process.env.GEMINI_API_KEY },
  { name: "Gemini 2.0 Flash", sdkModel: google("gemini-2.0-flash"), hasKey: !!process.env.GEMINI_API_KEY },
  // ── OpenRouter (free-tier fallback) ──
  { name: "OR GPT-OSS 20B", sdkModel: openrouter("openai/gpt-oss-20b:free"), hasKey: !!process.env.OPENROUTER_API_KEY },
];

// ─── REFINE Pool (needs good instruction-following for structural edits) ───────

export const REFINE_POOL: ProviderConfig[] = [
  // ── Groq (fast + smart, 100k TPD each) ──
  { name: "Groq Llama 3.3 70B", sdkModel: groq("llama-3.3-70b-versatile"), hasKey: !!process.env.GROQ_API_KEY },
  { name: "Groq Qwen3 32B", sdkModel: groq("qwen/qwen3-32b"), hasKey: !!process.env.GROQ_API_KEY },
  { name: "Groq GPT-OSS 120B", sdkModel: groq("openai/gpt-oss-120b"), hasKey: !!process.env.GROQ_API_KEY },
  { name: "Groq Llama 3.1 8B", sdkModel: groq("llama-3.1-8b-instant"), hasKey: !!process.env.GROQ_API_KEY },
  // ── Gemini (best instruction-following, 1500 RPD each) ──
  { name: "Gemini 2.5 Flash", sdkModel: google("gemini-2.5-flash"), hasKey: !!process.env.GEMINI_API_KEY },
  { name: "Gemini 2.5 Flash Lite", sdkModel: google("gemini-2.5-flash-lite"), hasKey: !!process.env.GEMINI_API_KEY },
  { name: "Gemini 3.1 Pro", sdkModel: google("gemini-3.1-pro-preview"), hasKey: !!process.env.GEMINI_API_KEY },
  // ── OpenRouter (free-tier fallback) ──
  { name: "OR GPT-OSS 120B", sdkModel: openrouter("openai/gpt-oss-120b:free"), hasKey: !!process.env.OPENROUTER_API_KEY },
  { name: "OR Nemotron 120B", sdkModel: openrouter("nvidia/nemotron-3-super-120b-a12b:free"), hasKey: !!process.env.OPENROUTER_API_KEY },
];

// ─── Round-Robin Counter ───────────────────────────────────────────────────────

const counters = new Map<string, number>();

function getNextIndex(poolName: string, poolSize: number): number {
  const current = counters.get(poolName) ?? 0;
  const next = (current + 1) % poolSize;
  counters.set(poolName, next);
  return current;
}

export function getRotatedChain(poolName: string, pool: ProviderConfig[]): ProviderConfig[] {
  // Filter out providers with no API key configured
  const available = pool.filter((p) => p.hasKey);
  if (available.length === 0) return [];

  const startIndex = getNextIndex(poolName, available.length);
  return [...available.slice(startIndex), ...available.slice(0, startIndex)];
}
