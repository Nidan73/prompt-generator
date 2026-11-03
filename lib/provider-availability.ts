import { describeError } from "./api-observability";

/**
 * Live model lists for Groq and Gemini, so a pinned model the provider has
 * retired drops out of the chain by itself instead of burning a fallback hop on
 * every rotation.
 *
 * Callers only ever peek: a cold or stale cache answers null (meaning "unknown,
 * keep the entry") and refreshes in the background, so availability never adds
 * latency to a request.
 */

export type AvailabilityProvider = "groq" | "gemini";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// A failed refresh is retried after a short pause, not on every request.
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;
const GROQ_URL = "https://api.groq.com/openai/v1/models";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";

type Entry = { ids: ReadonlySet<string> | null; expiresAt: number; failureLogged: boolean };

const cache = new Map<AvailabilityProvider, Entry>();
const inFlight = new Map<AvailabilityProvider, Promise<void>>();
let fetchImpl: typeof fetch | null = null;

/** Test seam: inject a fetch implementation, or pass null to restore the default. */
export function setAvailabilityFetch(impl: typeof fetch | null): void {
  fetchImpl = impl;
}

/** Test seam: forget every cached list and in-flight refresh. */
export function resetAvailabilityCache(): void {
  cache.clear();
  inFlight.clear();
}

function apiKey(provider: AvailabilityProvider): string | undefined {
  return (provider === "groq" ? process.env.GROQ_API_KEY : process.env.GEMINI_API_KEY) || undefined;
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await (fetchImpl ?? fetch)(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`model list responded ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function listGroq(key: string): Promise<Set<string>> {
  const body = (await getJson(GROQ_URL, { Authorization: `Bearer ${key}` })) as {
    data?: Array<{ id?: string }>;
  };
  return new Set((body.data ?? []).flatMap((model) => (model.id ? [model.id] : [])));
}

async function listGemini(key: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let pageToken: string | undefined;

  // Bounded so a misbehaving token loop cannot spin forever.
  for (let page = 0; page < 10; page += 1) {
    const url = pageToken ? `${GEMINI_URL}&pageToken=${encodeURIComponent(pageToken)}` : GEMINI_URL;
    const body = (await getJson(url, { "x-goog-api-key": key })) as {
      models?: Array<{ name?: string }>;
      nextPageToken?: string;
    };

    for (const model of body.models ?? []) {
      if (model.name) ids.add(model.name.replace(/^models\//, ""));
    }

    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }

  return ids;
}

/** Refreshes one provider's list. Deduplicated, never rejects. */
export function refreshAvailableModels(provider: AvailabilityProvider): Promise<void> {
  const key = apiKey(provider);
  if (!key) return Promise.resolve();

  const running = inFlight.get(provider);
  if (running) return running;

  const task = (async () => {
    const previous = cache.get(provider);
    try {
      const ids = provider === "groq" ? await listGroq(key) : await listGemini(key);
      // An empty list is far likelier a bad response than a provider with no models.
      if (ids.size === 0) throw new Error("model list was empty");
      cache.set(provider, { ids, expiresAt: Date.now() + CACHE_TTL_MS, failureLogged: false });
    } catch (error) {
      if (!previous?.failureLogged) {
        console.warn(
          JSON.stringify({
            scope: "bhai-thik-kor",
            event: "provider_availability_failed",
            provider,
            ...describeError(error),
          }),
        );
      }
      // Keep serving a stale list rather than forgetting what we knew.
      cache.set(provider, {
        ids: previous?.ids ?? null,
        expiresAt: Date.now() + RETRY_AFTER_FAILURE_MS,
        failureLogged: true,
      });
    } finally {
      inFlight.delete(provider);
    }
  })();

  inFlight.set(provider, task);
  return task;
}

/** Cached live model ids, or null when unknown. Starts a refresh when stale. */
export function peekAvailableModelIds(provider: AvailabilityProvider): ReadonlySet<string> | null {
  const entry = cache.get(provider);

  if (!entry || entry.expiresAt <= Date.now()) void refreshAvailableModels(provider);

  return entry?.ids ?? null;
}
