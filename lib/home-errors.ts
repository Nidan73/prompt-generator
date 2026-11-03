export type ParsedApiError = {
  message?: string;
  retryAfter?: number;
};

// The AI SDK hooks throw an Error whose message is the raw response body, so a
// server error like { "error": "...", "retryAfter": 30 } arrives as JSON text.
export function parseApiError(error: unknown): ParsedApiError {
  if (!(error instanceof Error)) {
    return {};
  }

  let body: unknown;
  try {
    body = JSON.parse(error.message);
  } catch {
    return {};
  }

  if (typeof body !== "object" || body === null) {
    return {};
  }

  const { error: message, retryAfter } = body as { error?: unknown; retryAfter?: unknown };
  const parsed: ParsedApiError = {};

  if (typeof message === "string" && message) {
    parsed.message = message;
  }
  if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) {
    parsed.retryAfter = retryAfter;
  }

  return parsed;
}

// Waits up to this long use the global cooldown timer. Longer ones are daily
// caps, which only describe themselves and must not lock unrelated features.
export const MAX_COOLDOWN_SECONDS = 120;

export function formatWait(seconds: number): string {
  const total = Math.max(1, Math.ceil(seconds));
  if (total < MAX_COOLDOWN_SECONDS) {
    return `${total} s`;
  }

  const minutes = Math.ceil(total / 60);
  if (total < 3600) {
    return `about ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `about ${hours} h ${rest} min` : `about ${hours} h`;
}

export type RateLimitPlan = { cooldownSeconds: number } | { message: string };

export function planRateLimit({ message, retryAfter }: ParsedApiError): RateLimitPlan | null {
  if (typeof retryAfter !== "number") {
    return null;
  }

  const seconds = Math.max(1, Math.ceil(retryAfter));
  if (seconds <= MAX_COOLDOWN_SECONDS) {
    return { cooldownSeconds: seconds };
  }

  return { message: `${message ?? "Limit reached."} Try again in ${formatWait(seconds)}.` };
}
