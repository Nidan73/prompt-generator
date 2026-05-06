/**
 * Local-First Prompt History
 *
 * Persists the last 10 generated prompts + routing results
 * to localStorage. Zero server cost, survives page refreshes.
 */

const STORAGE_KEY = "prompt-generator-history";
const MAX_ENTRIES = 10;

export type HistoryEntry = {
  id: string;
  timestamp: number;
  inputPrompt: string;
  optimizedPrompt: string;
  recommendations: Record<
    string,
    { model_name: string; platform_url: string; reasoning: string }
  >;
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function saveToHistory(entry: Omit<HistoryEntry, "id" | "timestamp">): void {
  try {
    const history = getHistory();
    const newEntry: HistoryEntry = {
      id: generateId(),
      timestamp: Date.now(),
      ...entry,
    };
    // Prepend new entry and cap at MAX_ENTRIES
    const updated = [newEntry, ...history].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // localStorage may be full or unavailable — fail silently
  }
}

export function getHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // fail silently
  }
}

function isValidEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.timestamp === "number" &&
    typeof record.inputPrompt === "string" &&
    typeof record.optimizedPrompt === "string" &&
    typeof record.recommendations === "object" &&
    record.recommendations !== null
  );
}
