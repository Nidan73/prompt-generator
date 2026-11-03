"use client";

import { useEffect, useEffectEvent } from "react";
import { matchesShortcut } from "@/lib/shortcuts";

type KeyboardShortcutsOptions = {
  onGenerate: () => void;
  onCopy: () => void;
  onToggleHistory: () => void;
};

// The handlers are read through an Effect Event so the single window listener
// always runs the latest render's closures instead of the ones from mount.
export function useKeyboardShortcuts({ onGenerate, onCopy, onToggleHistory }: KeyboardShortcutsOptions) {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (matchesShortcut(event, { key: "Enter", mod: true })) {
      event.preventDefault();
      onGenerate();
      return;
    }

    if (matchesShortcut(event, { key: "c", mod: true, shift: true })) {
      event.preventDefault();
      onCopy();
      return;
    }

    if (matchesShortcut(event, { key: "h", mod: true })) {
      // Leave Ctrl+H alone while the user is typing in a field.
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      onToggleHistory();
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyDown(event);

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}
