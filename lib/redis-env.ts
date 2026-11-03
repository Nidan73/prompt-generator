import { Redis } from "@upstash/redis";

/**
 * The one place a Redis client is built from the environment.
 *
 * `Redis.fromEnv()` does not throw on missing or empty variables: it warns and
 * builds a client with an empty url, which then fails on every call. An empty
 * string must count as absent, so this checks first and returns null instead.
 * Both the Upstash names and the Vercel KV names are accepted.
 */
export function redisFromEnvOrNull(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}
