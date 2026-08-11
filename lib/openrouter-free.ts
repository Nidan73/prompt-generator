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
const FETCH_TIMEOUT_MS = 6000;

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

  catalogueInFlight = fetchCatalogue()
    .catch((error) => {
      console.warn(
        "OpenRouter catalogue unavailable, using last-known-good free models",
        error instanceof Error ? error.message : error,
      );
      // Short TTL on the fallback so the next request retries the live list.
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
    });

  return catalogueInFlight;
}

/** Free OpenRouter models available right now, best-context first. */
export async function getFreeModels(options: { structured: boolean }): Promise<FreeModel[]> {
  const catalogue = await getCatalogue();

  if (catalogue.source === "fallback") {
    return FALLBACK_FREE_MODELS.filter(
      (model) => !options.structured || model.structured,
    ).slice(0, MAX_MODELS_PER_POOL);
  }

  return selectFreeModels(catalogue.models, options);
}
