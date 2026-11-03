"use client";

import { useRef, useState } from "react";
import { encodePromptToHash } from "@/lib/share-link";
import type { DispatcherResponse, Recommendation } from "./types";

// Copy, copy-and-open and share, plus the transient "Copied" label they drive.
export function useClipboardActions(result: DispatcherResponse | null) {
  const [copied, setCopied] = useState("");
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copyText(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => setCopied(""), 1600);
  }

  async function copyAndOpen(recommendation: Recommendation) {
    if (result) {
      await copyText(recommendation.model_name, result.optimized_prompt);
    }

    window.open(recommendation.platform_url, "_blank", "noopener,noreferrer");
  }

  async function sharePrompt() {
    if (!result) return;
    const hash = encodePromptToHash(result.optimized_prompt);
    const shareUrl = `${window.location.origin}${window.location.pathname}${hash}`;
    await navigator.clipboard.writeText(shareUrl);
    setCopied("share");
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(""), 2000);
  }

  return { copied, setCopied, copyTimeoutRef, copyText, copyAndOpen, sharePrompt };
}
