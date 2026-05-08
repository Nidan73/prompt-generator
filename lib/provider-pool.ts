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

type ProviderHealth = {
  failures: number;
  coolingDownUntil: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  lastLatencyMs?: number;
};

const FAILURE_COOLDOWN_THRESHOLD = 2;
const PROVIDER_COOLDOWN_MS = 2 * 60 * 1000;
const providerHealth = new Map<string, ProviderHealth>();

function healthKey(poolName: string, providerName: string): string {
  return `${poolName}:${providerName}`;
}

function readProviderHealth(poolName: string, providerName: string): ProviderHealth {
  return providerHealth.get(healthKey(poolName, providerName)) ?? {
    failures: 0,
    coolingDownUntil: 0,
  };
}

function isCoolingDown(poolName: string, providerName: string, now = Date.now()): boolean {
  return readProviderHealth(poolName, providerName).coolingDownUntil > now;
}

export function recordProviderSuccess(
  poolName: string,
  providerName: string,
  latencyMs?: number,
) {
  providerHealth.set(healthKey(poolName, providerName), {
    failures: 0,
    coolingDownUntil: 0,
    lastSuccessAt: Date.now(),
    lastLatencyMs: latencyMs,
  });
}

export function recordProviderFailure(poolName: string, providerName: string) {
  const current = readProviderHealth(poolName, providerName);
  const failures = current.failures + 1;
  providerHealth.set(healthKey(poolName, providerName), {
    ...current,
    failures,
    coolingDownUntil:
      failures >= FAILURE_COOLDOWN_THRESHOLD ? Date.now() + PROVIDER_COOLDOWN_MS : 0,
    lastFailureAt: Date.now(),
  });
}

export function getPoolRuntimeStatus(poolName: string, pool: ProviderConfig[]) {
  const now = Date.now();
  const configured = pool.filter((provider) => provider.hasKey);
  const providers = configured.map((provider) => {
    const health = readProviderHealth(poolName, provider.name);
    const coolingDownForMs = Math.max(0, health.coolingDownUntil - now);

    return {
      name: provider.name,
      status: coolingDownForMs > 0 ? "cooling_down" : "ready",
      failures: health.failures,
      coolingDownForMs,
      lastLatencyMs: health.lastLatencyMs,
      lastFailureAt: health.lastFailureAt,
      lastSuccessAt: health.lastSuccessAt,
    };
  });

  return {
    total: pool.length,
    configured: configured.length,
    ready: providers.filter((provider) => provider.status === "ready").length,
    coolingDown: providers.filter((provider) => provider.status === "cooling_down").length,
    providers,
  };
}

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
  const configured = pool.filter((p) => p.hasKey);
  if (configured.length === 0) return [];

  const healthy = configured.filter((p) => !isCoolingDown(poolName, p.name));
  const available = healthy.length > 0 ? healthy : configured;

  const startIndex = getNextIndex(poolName, available.length);
  return [...available.slice(startIndex), ...available.slice(0, startIndex)];
}
