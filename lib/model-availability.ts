export type ModelRef = { pool: string; name: string; provider: string; modelId: string };

/**
 * Pinned models that a provider no longer lists. Providers without an entry in
 * `available` were not checked (no key, no network), so they are not reported.
 */
export function findMissingModels(
  pools: Record<string, Array<{ name: string; provider: string; modelId: string }>>,
  available: Partial<Record<string, ReadonlySet<string>>>,
): ModelRef[] {
  const missing: ModelRef[] = [];

  for (const [pool, entries] of Object.entries(pools)) {
    for (const { name, provider, modelId } of entries) {
      const ids = available[provider];
      if (ids && !ids.has(modelId)) missing.push({ pool, name, provider, modelId });
    }
  }

  return missing;
}
