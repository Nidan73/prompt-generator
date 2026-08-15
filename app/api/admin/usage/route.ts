import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import {
  CLARIFY_POOL,
  GENERATE_POOL,
  REFINE_POOL,
  getPoolRuntimeStatus,
} from "@/lib/provider-pool";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";
export const maxDuration = 30;

// ─── Provider Data Fetchers ──────────────────────────────────────────────────

async function fetchOpenRouterUsage() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { configured: false, status: "missing_key" };
  }

  try {
    const [keyRes, creditsRes] = await Promise.allSettled([
      fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    ]);

    let keyData = null;
    let creditsData = null;

    if (keyRes.status === "fulfilled" && keyRes.value.ok) {
      keyData = await keyRes.value.json().catch(() => null);
    }
    if (creditsRes.status === "fulfilled" && creditsRes.value.ok) {
      creditsData = await creditsRes.value.json().catch(() => null);
    }

    const data = keyData?.data;
    const credits = creditsData?.data;

    return {
      configured: true,
      status: "connected",
      label: data?.label ?? "Primary Key",
      limit: data?.limit ?? null,
      usageUsd: data?.usage ?? credits?.total_usage ?? 0,
      creditsRemainingUsd: credits?.total_credits ? Math.max(0, credits.total_credits - (credits.total_usage || 0)) : null,
      totalCreditsUsd: credits?.total_credits ?? null,
      isFreeTier: data?.is_free_tier ?? false,
      rateLimit: data?.rate_limit ?? { requests: 50, interval: "10s" },
    };
  } catch (err) {
    return {
      configured: true,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchGroqRateLimits() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { configured: false, status: "missing_key" };
  }

  try {
    const started = Date.now();
    // Non-metering probe: fetch models endpoint which returns rate limit headers
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "BhaiThikKor-Admin/1.0",
      },
    });

    const latencyMs = Date.now() - started;

    if (!res.ok) {
      return {
        configured: true,
        status: "error",
        statusCode: res.status,
        latencyMs,
      };
    }

    const headers = res.headers;
    const remainingRequests = headers.get("x-ratelimit-remaining-requests");
    const limitRequests = headers.get("x-ratelimit-limit-requests");
    const remainingTokens = headers.get("x-ratelimit-remaining-tokens");
    const limitTokens = headers.get("x-ratelimit-limit-tokens");
    const resetTokens = headers.get("x-ratelimit-reset-tokens");
    const resetRequests = headers.get("x-ratelimit-reset-requests");

    return {
      configured: true,
      status: "connected",
      latencyMs,
      remainingTokens: remainingTokens ? Number.parseInt(remainingTokens, 10) : null,
      limitTokens: limitTokens ? Number.parseInt(limitTokens, 10) : 100_000,
      resetTokens: resetTokens ?? "0s",
      remainingRequests: remainingRequests ? Number.parseInt(remainingRequests, 10) : null,
      limitRequests: limitRequests ? Number.parseInt(limitRequests, 10) : 30,
      resetRequests: resetRequests ?? "0s",
    };
  } catch (err) {
    return {
      configured: true,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchGeminiHealth() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { configured: false, status: "missing_key" };
  }

  try {
    const started = Date.now();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );
    const latencyMs = Date.now() - started;

    return {
      configured: true,
      status: res.ok ? "connected" : "error",
      statusCode: res.status,
      latencyMs,
      dailyQuotaLimit: 1500, // Google free tier 1,500 RPD
      rpmLimit: 15,
    };
  } catch (err) {
    return {
      configured: true,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchRedisMetrics() {
  try {
    const redis = Redis.fromEnv();
    const today = new Date().toISOString().slice(0, 10);

    const routes = ["generate", "clarify", "refine", "extract"];
    const metrics: Record<string, number> = {
      totalRequests: 0,
      totalSuccess: 0,
      totalError: 0,
      inputChars: 0,
      fallbacks: 0,
    };

    for (const route of routes) {
      const base = `btq:metrics:${today}:${route}`;
      const [events, success, error, chars, fallbacks] = await Promise.all([
        redis.get<number>(`${base}:events`).catch(() => 0),
        redis.get<number>(`${base}:success`).catch(() => 0),
        redis.get<number>(`${base}:error`).catch(() => 0),
        redis.get<number>(`${base}:input_chars`).catch(() => 0),
        redis.get<number>(`${base}:fallback_count`).catch(() => 0),
      ]);

      metrics.totalRequests += events ?? 0;
      metrics.totalSuccess += success ?? 0;
      metrics.totalError += error ?? 0;
      metrics.inputChars += chars ?? 0;
      metrics.fallbacks += fallbacks ?? 0;
    }

    return {
      configured: true,
      status: "connected",
      today,
      metrics,
    };
  } catch {
    return {
      configured: false,
      status: "unavailable",
      metrics: { totalRequests: 0, totalSuccess: 0, totalError: 0, inputChars: 0, fallbacks: 0 },
    };
  }
}

// ─── GET Handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!(await isAdminAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized access." }, { status: 401 });
  }

  const [openrouter, groq, gemini, redis] = await Promise.all([
    fetchOpenRouterUsage(),
    fetchGroqRateLimits(),
    fetchGeminiHealth(),
    fetchRedisMetrics(),
  ]);

  const pools = {
    generate: getPoolRuntimeStatus("generate", GENERATE_POOL),
    clarify: getPoolRuntimeStatus("clarify", CLARIFY_POOL),
    refine: getPoolRuntimeStatus("refine", REFINE_POOL),
  };

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    providers: {
      openrouter,
      groq,
      gemini,
      redis,
    },
    pools,
  });
}
