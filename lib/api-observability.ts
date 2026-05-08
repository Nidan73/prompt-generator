import type { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";

type RateLimitResult = {
  limit: number;
  remaining: number;
  reset: number;
};

export type ApiLogEvent = {
  route: string;
  event: string;
  status?: number;
  provider?: string;
  durationMs?: number;
  inputChars?: number;
  clarificationCount?: number;
  fallbackCount?: number;
  errorType?: string;
  details?: Record<string, boolean | number | string | null | undefined>;
};

let metricsRedis: Redis | null | undefined;

function getMetricsRedis() {
  if (metricsRedis !== undefined) return metricsRedis;

  try {
    metricsRedis = Redis.fromEnv();
  } catch {
    metricsRedis = null;
  }

  return metricsRedis;
}

export function getClientIdentifier(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip");
  const cloudflareIp = request.headers.get("cf-connecting-ip");
  return forwardedFor || realIp || cloudflareIp || "anonymous";
}

export function rateLimitHeaders(limit: RateLimitResult): HeadersInit {
  return {
    "X-RateLimit-Limit": String(limit.limit),
    "X-RateLimit-Remaining": String(limit.remaining),
    "X-RateLimit-Reset": String(limit.reset),
  };
}

export function retryAfterSeconds(reset: number) {
  return Math.max(1, Math.ceil((reset - Date.now()) / 1000));
}

export function classifyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("429") || lower.includes("rate limit")) return "provider_rate_limit";
  if (lower.includes("timeout") || lower.includes("abort")) return "timeout";
  if (lower.includes("schema") || lower.includes("json")) return "schema";
  if (lower.includes("api key") || lower.includes("unauthorized") || lower.includes("401")) {
    return "auth";
  }

  return "unknown";
}

export function logApiEvent(event: ApiLogEvent) {
  const payload = {
    scope: "bhai-thik-kor",
    timestamp: new Date().toISOString(),
    ...event,
  };
  const line = JSON.stringify(payload);

  if ((event.status ?? 200) >= 500 || event.event.includes("fallback")) {
    console.warn(line);
    return;
  }

  console.info(line);
}

export async function trackApiEvent(event: ApiLogEvent) {
  logApiEvent(event);
  await recordUsageCounters(event);
}

async function recordUsageCounters(event: ApiLogEvent) {
  const redis = getMetricsRedis();
  if (!redis) return;

  const activeRedis = redis;
  const date = new Date().toISOString().slice(0, 10);
  const base = `btq:metrics:${date}:${event.route}`;
  const ttlSeconds = 60 * 60 * 24 * 14;
  const keysToExpire = new Set<string>();
  const pipeline = activeRedis.pipeline();

  function incr(key: string, by = 1) {
    keysToExpire.add(key);
    if (by === 1) {
      pipeline.incr(key);
      return;
    }

    pipeline.incrby(key, by);
  }

  incr(`${base}:events`);
  incr(`${base}:event:${slug(event.event)}`);

  if (event.status) {
    incr(`${base}:status:${event.status}`);

    if (event.status >= 200 && event.status < 400) incr(`${base}:success`);
    if (event.status >= 400) incr(`${base}:error`);
  }

  if (event.provider) {
    incr(`${base}:provider:${slug(event.provider)}:${slug(event.event)}`);
  }

  if (event.errorType) {
    incr(`${base}:error_type:${slug(event.errorType)}`);
  }

  if (typeof event.inputChars === "number" && event.inputChars > 0) {
    incr(`${base}:input_chars`, event.inputChars);
  }

  if (typeof event.fallbackCount === "number" && event.fallbackCount > 0) {
    incr(`${base}:fallback_count`, event.fallbackCount);
  }

  try {
    for (const key of keysToExpire) {
      pipeline.expire(key, ttlSeconds);
    }

    await pipeline.exec();
  } catch (error) {
    console.warn(
      JSON.stringify({
        scope: "bhai-thik-kor",
        timestamp: new Date().toISOString(),
        route: event.route,
        event: "metrics_record_failed",
        errorType: classifyError(error),
      }),
    );
  }
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
