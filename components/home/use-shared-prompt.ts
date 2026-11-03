"use client";

import { useEffect, useState } from "react";
import { decodePromptFromHash } from "@/lib/share-link";

// Read-only view of a prompt shared through the URL hash.
export function useSharedPrompt() {
  const [sharedPrompt, setSharedPrompt] = useState<string | null>(null);

  // Decode shared prompt from URL hash on mount
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const hash = window.location.hash;
      const decoded = decodePromptFromHash(hash);
      if (decoded) {
        setSharedPrompt(decoded);
        // Clean the hash from the URL without reload
        window.history.replaceState(null, "", window.location.pathname);
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  return { sharedPrompt, dismissSharedPrompt: () => setSharedPrompt(null) };
}
