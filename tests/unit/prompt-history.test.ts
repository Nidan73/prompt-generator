// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHistory,
  getHistory,
  saveToHistory,
} from "../../lib/prompt-history";

const KEY = "prompt-generator-history";
const entry = (n: number) => ({
  inputPrompt: `in ${n}`,
  optimizedPrompt: `out ${n}`,
  recommendations: {},
});

// Node 26 exposes an unusable global localStorage that hides jsdom's, so use a stub.
function makeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe("prompt-history", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("prepends the newest entry", () => {
    saveToHistory(entry(1));
    saveToHistory(entry(2));
    const h = getHistory();
    expect(h.map((e) => e.inputPrompt)).toEqual(["in 2", "in 1"]);
    expect(typeof h[0].id).toBe("string");
    expect(typeof h[0].timestamp).toBe("number");
  });

  it("caps history at 10 entries", () => {
    for (let i = 1; i <= 12; i++) saveToHistory(entry(i));
    const h = getHistory();
    expect(h).toHaveLength(10);
    expect(h[0].inputPrompt).toBe("in 12");
    expect(h[9].inputPrompt).toBe("in 3");
  });

  it("drops invalid entries", () => {
    const valid = { id: "a", timestamp: 1, ...entry(1) };
    localStorage.setItem(
      KEY,
      JSON.stringify([valid, null, "x", { id: "b" }, { ...valid, recommendations: null }]),
    );
    expect(getHistory()).toEqual([valid]);
  });

  it("returns [] for non-array JSON", () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 1 }));
    expect(getHistory()).toEqual([]);
  });

  it("returns [] for invalid JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(getHistory()).toEqual([]);
  });

  it("clearHistory empties the store", () => {
    saveToHistory(entry(1));
    clearHistory();
    expect(getHistory()).toEqual([]);
  });

  it("does not throw when setItem throws", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveToHistory(entry(1))).not.toThrow();
  });
});
