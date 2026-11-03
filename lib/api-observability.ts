import { after, type NextRequest } from "next/server";
import { Redis } from "@upstash/redis";
import { parseIpv6 } from "./url-safety";

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

/**
 * Rate-limit key for a client address. A single IPv6 subscriber usually holds a
 * whole /64, so keying on the full address lets one client mint endless fresh
 * keys; the /64 prefix is the unit that actually identifies them.
 */
export function normalizeClientKey(raw: string): string {
  const value = raw.trim();
  const bytes = parseIpv6(value);
  if (!bytes) return value;

  const mapped = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped) return bytes.slice(12).join(".");

  const groups: string[] = [];
  for (let i = 0; i < 8; i += 2) {
    groups.push((((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)).toString(16));
  }
  return `${groups.join(":")}::/64`;
}

export function getClientIdentifier(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip");
  const cloudflareIp = request.headers.get("cf-connecting-ip");
  return normalizeClientKey(forwardedFor || realIp || cloudflareIp || "anonymous");
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

function numericStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { statusCode?: unknown }).statusCode;
  return typeof code === "number" ? code : undefined;
}

export function classifyError(error: unknown): string {
  const statusCode = numericStatusCode(error);
  if (statusCode === 429) return "provider_rate_limit";
  if (statusCode === 401 || statusCode === 403) return "auth";

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

/**
 * Log-safe summary of an error. Provider errors carry the request body and the
 * response body, which contain user prompts, so only these three fields leave.
 */
export function describeError(error: unknown): { name: string; statusCode?: number; errorType: string } {
  const statusCode = numericStatusCode(error);
  return {
    name: error instanceof Error ? error.name : "NonError",
    ...(statusCode !== undefined ? { statusCode } : {}),
    errorType: classifyError(error),
  };
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

/**
 * Log now, count later.
 *
 * The Redis pipeline used to be awaited inline, which put a round-trip in front
 * of every response, including the streaming ones, where it landed squarely on
 * time-to-first-token. `after()` runs it once the response is on its way
 * (backed by waitUntil on Vercel), so metering no longer costs the user latency.
 */
export function trackApiEvent(event: ApiLogEvent, options: { persist?: boolean } = {}): void {
  logApiEvent(event);

  // Requests rejected before rate limiting are free for an attacker to send, so
  // counting them in Redis would let anyone drive our command usage.
  if (options.persist === false) return;

  const record = () =>
    recordUsageCounters(event).catch(() => {
      // recordUsageCounters already logs; never let telemetry surface as an error.
    });

  try {
    after(record);
  } catch {
    // Outside a request scope (tests, scripts) `after` is unavailable.
    void record();
  }
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
