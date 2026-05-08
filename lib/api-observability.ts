import type { NextRequest } from "next/server";

type RateLimitResult = {
  limit: number;
  remaining: number;
  reset: number;
};

type ApiLogEvent = {
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
