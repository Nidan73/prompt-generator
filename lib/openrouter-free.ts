/**
 * OpenRouter Free Model Discovery
 *
 * OpenRouter's `:free` model IDs come and go — `openai/gpt-oss-120b:free` was
 * pinned in every pool and has since been removed from the catalogue entirely,
 * so each rotation onto it burned a fallback hop and cooled the slot down.
 *
 * Rather than naming models, ask OpenRouter which free ones exist right now and
 * use whatever is there. Falls back to a last-known-good list if the catalogue
 * is unreachable.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type OpenRouterCatalogueModel = {
  id?: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
};

export type FreeModel = {
  id: string;
  contextLength: number;
  structured: boolean;
};

// ─── Configuration ─────────────────────────────────────────────────────────────

const CATALOGUE_URL = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * Deliberately short. This fetch can sit in front of a user's first token on a
 * cold isolate, and OpenRouter models are the tail of the chain — waiting
 * seconds for an optional fallback is a bad trade.
 */
const FETCH_TIMEOUT_MS = 3000;

/** Keep the chain short; these are the tail of the rotation, not the front. */
const MAX_MODELS_PER_POOL = 4;

/** Model families that are not general-purpose chat. */
const NOISE_PATTERNS = [
  "content-safety",
  "guard",
  "moderation",
  "shield",
  "embedding",
  "tts",
  "whisper",
  "-vl", // vision-language variants: text-only prompts waste their capability
];

/**
 * Last known good, verified against the live catalogue on 2026-08-11. Used only
 * when the catalogue fetch fails, so a bad network moment does not silently
 * remove OpenRouter from the pools.
 */
const FALLBACK_FREE_MODELS: FreeModel[] = [
  { id: "openai/gpt-oss-20b:free", contextLength: 131072, structured: true },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", contextLength: 262144, structured: true },
  { id: "google/gemma-4-26b-a4b-it:free", contextLength: 262144, structured: true },
  { id: "nvidia/nemotron-nano-9b-v2:free", contextLength: 128000, structured: true },
  { id: "google/gemma-4-31b-it:free", contextLength: 262144, structured: false },
];

// ─── Pure Selection Logic ──────────────────────────────────────────────────────

function isZeroPriced(value: string | undefined): boolean {
  if (value === undefined) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed === 0;
}

/** A free, text-in/text-out chat model. */
export function isUsableFreeModel(model: OpenRouterCatalogueModel): boolean {
  const id = model.id ?? "";
  if (!id.endsWith(":free")) return false;

  // The `:free` suffix is the convention, but price is the actual contract.
  if (!isZeroPriced(model.pricing?.prompt)) return false;
  if (!isZeroPriced(model.pricing?.completion)) return false;

  const lowerId = id.toLowerCase();
  if (NOISE_PATTERNS.some((pattern) => lowerId.includes(pattern))) return false;

  const inputs = model.architecture?.input_modalities ?? ["text"];
  const outputs = model.architecture?.output_modalities ?? ["text"];
  return inputs.includes("text") && outputs.includes("text");
}

export function supportsStructuredOutput(model: OpenRouterCatalogueModel): boolean {
  return (model.supported_parameters ?? []).includes("structured_outputs");
}

/**
 * `structured: true` is required by any route using generateObject/streamObject —
 * a model without it fails after the response has already started streaming.
 */
export function selectFreeModels(
  models: OpenRouterCatalogueModel[],
  options: { structured: boolean; limit?: number } = { structured: false },
): FreeModel[] {
  const limit = options.limit ?? MAX_MODELS_PER_POOL;

  return models
    .filter(isUsableFreeModel)
    .filter((model) => !options.structured || supportsStructuredOutput(model))
    .map((model) => ({
      id: model.id as string,
      contextLength: model.context_length ?? 0,
      structured: supportsStructuredOutput(model),
    }))
    // Deterministic order so the round-robin counter stays meaningful between
    // requests: biggest context first, id as the tie-breaker.
    .sort((a, b) => b.contextLength - a.contextLength || a.id.localeCompare(b.id))
    .slice(0, limit);
}

// ─── Catalogue Fetch + Cache ───────────────────────────────────────────────────

type CatalogueCache = {
  models: OpenRouterCatalogueModel[];
  source: "live" | "fallback";
  expiresAt: number;
};

let catalogueCache: CatalogueCache | null = null;
let catalogueInFlight: Promise<CatalogueCache> | null = null;

async function fetchCatalogue(): Promise<CatalogueCache> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(CATALOGUE_URL, {
      signal: controller.signal,
      next: { revalidate: 21600 },
    });

    if (!response.ok) throw new Error(`OpenRouter catalogue responded ${response.status}`);

    const body = (await response.json()) as { data?: OpenRouterCatalogueModel[] };
    const models = Array.isArray(body.data) ? body.data : [];
    if (models.length === 0) throw new Error("OpenRouter catalogue was empty");

    return { models, source: "live", expiresAt: Date.now() + CACHE_TTL_MS };
  } finally {
    clearTimeout(timeout);
  }
}

async function getCatalogue(): Promise<CatalogueCache> {
  const now = Date.now();
  if (catalogueCache && catalogueCache.expiresAt > now) return catalogueCache;
  if (catalogueInFlight) return catalogueInFlight;

  const stale = catalogueCache;

  catalogueInFlight = fetchCatalogue()
    .catch((error) => {
      console.warn(
        "OpenRouter catalogue unavailable, using last-known-good free models",
        error instanceof Error ? error.message : error,
      );

      // Serving a slightly stale *live* list beats dropping back to IDs pinned
      // in source — going stale-to-hardcoded is the exact failure this module
      // exists to prevent. Only shorten the TTL so the next request retries.
      if (stale && stale.source === "live" && stale.models.length > 0) {
        return { ...stale, expiresAt: Date.now() + 5 * 60 * 1000 };
      }

      return {
        models: [],
        source: "fallback" as const,
        expiresAt: Date.now() + 5 * 60 * 1000,
      };
    })
    .then((result) => {
      catalogueCache = result;
      catalogueInFlight = null;
      return result;
    })
    .catch((error) => {
      catalogueInFlight = null;
      throw error;
    });

  return catalogueInFlight;
}

function lastKnownGood(structured: boolean): FreeModel[] {
  return FALLBACK_FREE_MODELS.filter((model) => !structured || model.structured).slice(
    0,
    MAX_MODELS_PER_POOL,
  );
}

/**
 * Non-blocking variant: answer from cache, refresh in the background.
 *
 * Used when the static pools already have healthy providers, so discovery never
 * costs the user latency for models that sit at the back of the chain anyway.
 * Returns an empty list on a cold isolate — correct, because the caller has
 * better options and the next request will have the warmed cache.
 */
export function peekFreeModels(options: { structured: boolean }): FreeModel[] {
  const now = Date.now();

  if (!catalogueCache || catalogueCache.expiresAt <= now) {
    // Warm it for the requests behind this one; failures are already logged.
    void getCatalogue().catch(() => undefined);
  }

  if (!catalogueCache) return [];
  if (catalogueCache.source === "fallback") return lastKnownGood(options.structured);

  return selectFreeModels(catalogueCache.models, options);
}

/** Free OpenRouter models available right now, best-context first. */
export async function getFreeModels(options: { structured: boolean }): Promise<FreeModel[]> {
  const catalogue = await getCatalogue();

  if (catalogue.source === "fallback") return lastKnownGood(options.structured);

  const selected = selectFreeModels(catalogue.models, options);

  // A live fetch that selects nothing is not the same as OpenRouter having
  // nothing: today only a handful of free models advertise structured output,
  // so one policy change upstream would silently empty this list.
  if (selected.length === 0) {
    console.warn(
      JSON.stringify({
        scope: "bhai-thik-kor",
        event: "openrouter_selection_empty",
        structured: options.structured,
        catalogueSize: catalogue.models.length,
      }),
    );
    return lastKnownGood(options.structured);
  }

  return selected;
}
