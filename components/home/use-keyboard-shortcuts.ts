"use client";

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { getHistory, type HistoryEntry } from "@/lib/prompt-history";
import type { DispatcherResponse } from "./types";

type KeyboardShortcutsOptions = {
  hasEnoughContext: boolean;
  isCurrentlyLoading: boolean;
  isCoolingDown: boolean;
  isGuidedModeEnabled: boolean;
  isGuided: boolean;
  result: DispatcherResponse | null;
  outputMode: "chat" | "api";
  requestClarifications: () => void;
  generatePrompt: () => void;
  getApiModeOutput: () => string;
  setCopied: Dispatch<SetStateAction<string>>;
  copyTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setShowHistory: Dispatch<SetStateAction<boolean>>;
  setHistory: Dispatch<SetStateAction<HistoryEntry[]>>;
};

export function useKeyboardShortcuts({
  hasEnoughContext,
  isCurrentlyLoading,
  isCoolingDown,
  isGuidedModeEnabled,
  isGuided,
  result,
  outputMode,
  requestClarifications,
  generatePrompt,
  getApiModeOutput,
  setCopied,
  copyTimeoutRef,
  setShowHistory,
  setHistory,
}: KeyboardShortcutsOptions) {
  // Keyboard shortcuts for power users
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      // Ctrl/Cmd + Enter → Generate prompt
      if (e.key === "Enter") {
        e.preventDefault();
        if (hasEnoughContext && !isCurrentlyLoading && !isCoolingDown) {
          if (isGuidedModeEnabled && !isGuided) {
            requestClarifications();
          } else {
            generatePrompt();
          }
        }
        return;
      }

      // Ctrl/Cmd + Shift + C → Copy output
      if (e.key === "C" && e.shiftKey) {
        e.preventDefault();
        if (result) {
          const text = outputMode === "api" ? getApiModeOutput() : result.optimized_prompt;
          navigator.clipboard.writeText(text);
          setCopied("prompt");
          if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
          copyTimeoutRef.current = setTimeout(() => setCopied(""), 1600);
        }
        return;
      }

      // Ctrl/Cmd + H → Toggle history
      if (e.key === "h" || e.key === "H") {
        // Don't capture if user is typing in an input/textarea
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        setShowHistory((prev) => !prev);
        setHistory(getHistory());
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEnoughContext, isCurrentlyLoading, isCoolingDown, isGuidedModeEnabled, isGuided, result, outputMode]);
}
