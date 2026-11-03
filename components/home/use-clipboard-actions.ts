"use client";

import { useEffect, useRef, useState } from "react";
import { encodePromptToHash } from "@/lib/share-link";
import type { DispatcherResponse, Recommendation } from "./types";

export const CLIPBOARD_ERROR_MESSAGE = "Could not copy to the clipboard. Select the text and copy it manually.";

// Copy, copy-and-open and share, plus the transient "Copied" label they drive.
export function useClipboardActions(
  result: DispatcherResponse | null,
  onError: (message: string) => void,
  onCopied: () => void,
) {
  const [copied, setCopied] = useState("");
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  // writeText rejects without permission or in an insecure context, and the
  // clipboard object itself can be missing, so both land in the same catch.
  async function writeToClipboard(label: string, text: string, resetAfterMs: number) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      onError(CLIPBOARD_ERROR_MESSAGE);
      return;
    }

    setCopied(label);
    onCopied();
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(""), resetAfterMs);
  }

  function copyText(label: string, text: string) {
    return writeToClipboard(label, text, 1600);
  }

  async function copyAndOpen(recommendation: Recommendation) {
    // Browsers only allow window.open inside the click's user activation, so the
    // write starts first, the tab opens in the same tick, and only then do we wait.
    const write = result
      ? copyText(recommendation.model_name, result.optimized_prompt)
      : Promise.resolve();

    window.open(recommendation.platform_url, "_blank", "noopener,noreferrer");
    await write;
  }

  async function sharePrompt() {
    if (!result) return;
    const hash = encodePromptToHash(result.optimized_prompt);
    const shareUrl = `${window.location.origin}${window.location.pathname}${hash}`;
    await writeToClipboard("share", shareUrl, 2000);
  }

  return { copied, setCopied, copyText, copyAndOpen, sharePrompt };
}
