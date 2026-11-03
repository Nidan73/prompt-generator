export type ShortcutEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type ShortcutSpec = {
  key: string;
  mod: true;
  shift?: boolean;
};

// Shift is part of the match so Ctrl+C never fires the Ctrl+Shift+C copy action,
// and Alt must be up so AltGr combinations on some layouts are not caught.
export function matchesShortcut(event: ShortcutEvent, spec: ShortcutSpec): boolean {
  if (!event.ctrlKey && !event.metaKey) return false;
  if (event.altKey) return false;
  if (event.shiftKey !== (spec.shift ?? false)) return false;

  return event.key.toLowerCase() === spec.key.toLowerCase();
}
