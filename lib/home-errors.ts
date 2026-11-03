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
