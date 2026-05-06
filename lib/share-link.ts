/**
 * Shareable Prompt Links via URL Hash
 *
 * Compresses the generated prompt using lz-string and encodes
 * it into the URL hash. Zero backend cost, infinite shareability.
 */

import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";

const VERSION_PREFIX = "v1-";

/**
 * Compress a prompt string and return a URL hash string.
 * e.g., "#v1-NobwRA..." 
 */
export function encodePromptToHash(prompt: string): string {
  const compressed = compressToEncodedURIComponent(prompt);
  return `#${VERSION_PREFIX}${compressed}`;
}

/**
 * Decode a prompt from a URL hash string.
 * Returns null if the hash is missing, malformed, or not a v1 hash.
 */
export function decodePromptFromHash(hash: string): string | null {
  if (!hash || !hash.startsWith(`#${VERSION_PREFIX}`)) return null;

  const compressed = hash.slice(1 + VERSION_PREFIX.length);
  if (!compressed) return null;

  try {
    const decompressed = decompressFromEncodedURIComponent(compressed);
    return decompressed && decompressed.trim() ? decompressed : null;
  } catch {
    return null;
  }
}
