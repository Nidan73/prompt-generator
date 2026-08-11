import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { Redis } from "@upstash/redis";
import type { LanguageModel } from "ai";
import { getFreeModels, peekFreeModels } from "./openrouter-free";

/**
 * Provider Pool — Round-Robin Load Balancer (AI SDK Streaming Version)
 *
 * Instead of a static fallback chain that hammers one provider until it dies,
 * this module spreads requests across the available models with a round-robin
 * counter, and takes failing providers out of rotation for a cooldown.
 *
 * What is and is not shared across instances: the cooldown state is (via Redis,
 * see below) because re-probing a provider everyone else already knows is down
 * costs a real API call and real latency. The counter is not — it starts at a
 * random offset per isolate, which spreads cold starts across the pool without
 * charging every request a round-trip for perfectly even distribution.
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

/**
 * Cooldowns are shared through Redis; the counter is not.
 *
 * This module's state used to live only in isolate memory, which on a
 * serverless platform means it barely lives at all: every cold isolate starts
 * with an empty failure history and a counter of 0, so a provider that is down
 * gets re-probed by each new isolate and the front of the chain absorbs most of
 * the traffic. The circuit breaker is the part worth sharing, so cooldowns go to
 * Redis (read at most once per REFRESH window, written fire-and-forget) while
 * the counter just starts at a random offset — enough to spread cold isolates
 * across the pool without putting a round-trip on every request.
 */
const SHARED_COOLDOWN_KEY = "btq:provider-cooldown";
const SHARED_COOLDOWN_REFRESH_MS = 10_000;

let sharedCooldowns: { fetchedAt: number; entries: Map<string, number> } | null = null;

let poolRedis: Redis | null | undefined;

function getPoolRedis(): Redis | null {
  if (poolRedis !== undefined) return poolRedis;

  try {
    poolRedis = Redis.fromEnv();
  } catch {
    poolRedis = null;
  }

  return poolRedis;
}

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
  if (readProviderHealth(poolName, providerName).coolingDownUntil > now) return true;

  const shared = sharedCooldowns?.entries.get(healthKey(poolName, providerName));
  return shared !== undefined && shared > now;
}

/**
 * Refreshes the shared cooldown view at most once per REFRESH window, so the
 * extra Redis hop is amortised across requests instead of charged to each one.
 */
async function refreshSharedCooldowns(): Promise<void> {
  const now = Date.now();
  if (sharedCooldowns && now - sharedCooldowns.fetchedAt < SHARED_COOLDOWN_REFRESH_MS) return;

  const redis = getPoolRedis();
  if (!redis) return;

  try {
    const raw = await redis.hgetall<Record<string, string | number>>(SHARED_COOLDOWN_KEY);
    const entries = new Map<string, number>();

    for (const [key, value] of Object.entries(raw ?? {})) {
      const expiresAt = Number(value);
      if (Number.isFinite(expiresAt) && expiresAt > now) entries.set(key, expiresAt);
    }

    sharedCooldowns = { fetchedAt: now, entries };
  } catch {
    // A cooldown we cannot read is not worth failing a request over; the
    // in-memory view still applies.
    sharedCooldowns = { fetchedAt: now, entries: sharedCooldowns?.entries ?? new Map() };
  }
}

function publishCooldown(key: string, until: number): void {
  const redis = getPoolRedis();
  if (!redis) return;

  // Fire-and-forget: the request that discovered the failure should not wait to
  // tell everyone else about it.
  void (async () => {
    try {
      await redis.hset(SHARED_COOLDOWN_KEY, { [key]: until });
      // Bounds the hash if providers churn (discovered OpenRouter IDs come and go).
      await redis.expire(SHARED_COOLDOWN_KEY, 3600);
    } catch {
      // Best effort only.
    }
  })();
}

export function recordProviderSuccess(
  poolName: string,
  providerName: string,
  latencyMs?: number,
) {
  const key = healthKey(poolName, providerName);
  providerHealth.set(key, {
    failures: 0,
    coolingDownUntil: 0,
    lastSuccessAt: Date.now(),
    lastLatencyMs: latencyMs,
  });

  // A provider that just worked should not stay cooled down for everyone else.
  if (sharedCooldowns?.entries.delete(key)) {
    const redis = getPoolRedis();
    if (redis) void redis.hdel(SHARED_COOLDOWN_KEY, key).catch(() => undefined);
  }
}

export function recordProviderFailure(poolName: string, providerName: string) {
  const key = healthKey(poolName, providerName);
  const current = readProviderHealth(poolName, providerName);
  const failures = current.failures + 1;
  const coolingDownUntil =
    failures >= FAILURE_COOLDOWN_THRESHOLD ? Date.now() + PROVIDER_COOLDOWN_MS : 0;

  providerHealth.set(key, {
    ...current,
    failures,
    coolingDownUntil,
    lastFailureAt: Date.now(),
  });

  if (coolingDownUntil > 0) {
    sharedCooldowns?.entries.set(key, coolingDownUntil);
    publishCooldown(key, coolingDownUntil);
  }
}

/**
 * OpenRouter models are discovered per request rather than listed in the static
 * pools, so readiness has to consider the key on its own — otherwise a
 * deployment configured with only OPENROUTER_API_KEY reports zero providers and
 * /api/health returns 503 while generation is in fact working.
 */
export function hasDiscoveredProviderSource(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
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

  const discoveredEnabled = hasDiscoveredProviderSource();

  return {
    total: pool.length,
    configured: configured.length,
    ready: providers.filter((provider) => provider.status === "ready").length,
    coolingDown: providers.filter((provider) => provider.status === "cooling_down").length,
    /** OpenRouter models are resolved at request time and are not counted above. */
    discoveredEnabled,
    usable: configured.length > 0 || discoveredEnabled,
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
  // OpenRouter free models are appended at request time by getChain() — their
  // IDs change too often to pin here.
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
  // OpenRouter free models are appended at request time by getChain().
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
  // OpenRouter free models are appended at request time by getChain().
];

// ─── Round-Robin Counter ───────────────────────────────────────────────────────

const counters = new Map<string, number>();

/**
 * The stored counter must be taken modulo the *current* pool size.
 *
 * Chain length varies per request — discovery returns 0-4 OpenRouter models, the
 * structured/unstructured filters differ, and cooldowns remove entries. Without
 * the modulo a stored index could exceed the pool, making `slice(startIndex)`
 * empty so the chain came back unrotated and the already-hot first provider took
 * the request again.
 *
 * The starting offset is randomised per isolate so cold starts spread across the
 * pool instead of every new isolate opening at index 0.
 */
function getNextIndex(poolName: string, poolSize: number): number {
  if (poolSize <= 0) return 0;

  const stored = counters.get(poolName);
  const current = (stored ?? Math.floor(Math.random() * poolSize)) % poolSize;
  counters.set(poolName, (current + 1) % poolSize);
  return current;
}

// ─── OpenRouter Free Tier (discovered, not pinned) ─────────────────────────────

/**
 * Whatever OpenRouter is giving away right now, as pool entries. Appended to the
 * end of a chain so it stays a safety net behind Groq and Gemini.
 *
 * `structured` must be true for any route using generateObject/streamObject:
 * a model without structured output support fails mid-stream, after the HTTP
 * response has already started.
 */
function toProviderConfigs(models: { id: string }[]): ProviderConfig[] {
  return models.map((model) => ({
    name: `OR ${model.id}`,
    sdkModel: openrouter(model.id),
    hasKey: true,
  }));
}

async function getOpenRouterFreeProviders(
  structured: boolean,
  blocking: boolean,
): Promise<ProviderConfig[]> {
  if (!process.env.OPENROUTER_API_KEY) return [];

  // When the static pools can serve the request, never wait on discovery — the
  // catalogue fetch would otherwise sit in front of the user's first token on
  // every cold isolate, for models that are the last resort in the chain.
  if (!blocking) return toProviderConfigs(peekFreeModels({ structured }));

  try {
    return toProviderConfigs(await getFreeModels({ structured }));
  } catch (error) {
    console.warn(
      "OpenRouter free model discovery failed; continuing without it",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

/**
 * The rotated chain for a request, including any free OpenRouter models that
 * exist right now. Prefer this over getRotatedChain() at call sites.
 */
export async function getChain(
  poolName: string,
  pool: ProviderConfig[],
  options: { structured: boolean },
): Promise<ProviderConfig[]> {
  await refreshSharedCooldowns();

  // Only pay for discovery when the static pool cannot serve this request.
  const staticallyReady = pool.some(
    (provider) => provider.hasKey && !isCoolingDown(poolName, provider.name),
  );
  const discovered = await getOpenRouterFreeProviders(options.structured, !staticallyReady);

  return getRotatedChain(poolName, [...pool, ...discovered]);
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
