/**
 * Rate Limiter Construction
 *
 * Building a Redis client at module scope, as every route used to, ties import
 * time to the environment, and `Redis.fromEnv()` does not even fail cleanly:
 * with the variables absent or empty it builds a client with an empty url that
 * errors on every call.
 *
 * Here the store is built lazily through redisFromEnvOrNull(), which returns
 * null when the variables are missing: routes keep serving, /api/health reports
 * the store as missing, and each request is logged as unmetered rather than
 * silently dropped.
 */

import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";
import { redisFromEnvOrNull } from "./redis-env";

export type LimitDecision = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  /** True when no store was reachable and the request was allowed unmetered. */
  degraded: boolean;
  /** Which kind of limiter produced this decision. */
  scope: LimitScope;
};

export type LimitScope = "minute" | "day" | "window";

let sharedRedis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (sharedRedis !== undefined) return sharedRedis;

  try {
    sharedRedis = redisFromEnvOrNull();
  } catch {
    sharedRedis = null;
  }

  if (!sharedRedis) {
    console.warn(
      JSON.stringify({
        scope: "bhai-thik-kor",
        event: "ratelimit_store_unavailable",
        detail: "Upstash env vars missing; requests will not be rate limited",
      }),
    );
  }

  return sharedRedis;
}

export function isRateLimitStoreConfigured(): boolean {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
      (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN),
  );
}

/** An allow-everything decision, used whenever the store cannot answer. */
function unmetered(limit: number, scope: LimitScope): LimitDecision {
  return {
    success: true,
    limit,
    remaining: limit,
    reset: Date.now() + 60_000,
    degraded: true,
    scope,
  };
}

export type RateLimitHandle = {
  check: (identifier: string) => Promise<LimitDecision>;
};

/**
 * Lazily-built limiter. `window` follows @upstash/ratelimit's duration syntax.
 *
 * Fails open: an Upstash outage should degrade metering, not take the whole
 * product offline. The provider pools have their own quotas behind this.
 */
export function createRateLimit(options: {
  tokens: number;
  window: Parameters<typeof Ratelimit.slidingWindow>[1];
  prefix: string;
  scope: LimitScope;
}): RateLimitHandle {
  let limiter: Ratelimit | null | undefined;

  function getLimiter(): Ratelimit | null {
    if (limiter !== undefined) return limiter;

    const redis = getRedis();
    limiter = redis
      ? new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(options.tokens, options.window),
          analytics: false,
          prefix: options.prefix,
        })
      : null;

    return limiter;
  }

  return {
    async check(identifier: string): Promise<LimitDecision> {
      const active = getLimiter();
      if (!active) return unmetered(options.tokens, options.scope);

      try {
        const result = await active.limit(identifier);
        return {
          success: result.success,
          limit: result.limit,
          remaining: result.remaining,
          reset: result.reset,
          degraded: false,
          scope: options.scope,
        };
      } catch (error) {
        console.warn(
          JSON.stringify({
            scope: "bhai-thik-kor",
            event: "ratelimit_check_failed",
            prefix: options.prefix,
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
        return unmetered(options.tokens, options.scope);
      }
    },
  };
}

/**
 * Check limiters in order and stop at the first denial, so a request already
 * refused by the per-minute limit does not also spend daily quota. When all
 * pass, the tightest remaining count is reported to the client.
 */
export async function checkRateLimits(
  identifier: string,
  handles: RateLimitHandle[],
): Promise<LimitDecision> {
  let tightest: LimitDecision | undefined;

  for (const handle of handles) {
    const decision = await handle.check(identifier);
    if (!decision.success) return decision;
    if (!tightest || decision.remaining < tightest.remaining) tightest = decision;
  }

  if (!tightest) throw new Error("checkRateLimits requires at least one handle");
  return tightest;
}
