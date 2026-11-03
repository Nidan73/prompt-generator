import { describe, expect, it } from "vitest";
import { matchesShortcut } from "../../lib/shortcuts";

function keyEvent(overrides: Partial<Parameters<typeof matchesShortcut>[0]>) {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("matchesShortcut", () => {
  it("matches Ctrl+Enter", () => {
    expect(
      matchesShortcut(keyEvent({ key: "Enter", ctrlKey: true }), { key: "Enter", mod: true }),
    ).toBe(true);
  });

  it("matches Meta+Enter", () => {
    expect(
      matchesShortcut(keyEvent({ key: "Enter", metaKey: true }), { key: "Enter", mod: true }),
    ).toBe(true);
  });

  it("rejects Enter without Ctrl or Meta", () => {
    expect(matchesShortcut(keyEvent({ key: "Enter" }), { key: "Enter", mod: true })).toBe(false);
  });

  it("rejects Ctrl+Alt+Enter", () => {
    expect(
      matchesShortcut(keyEvent({ key: "Enter", ctrlKey: true, altKey: true }), {
        key: "Enter",
        mod: true,
      }),
    ).toBe(false);
  });

  it("rejects Ctrl+Shift+Enter when shift is not requested", () => {
    expect(
      matchesShortcut(keyEvent({ key: "Enter", ctrlKey: true, shiftKey: true }), {
        key: "Enter",
        mod: true,
      }),
    ).toBe(false);
  });

  it("tells Ctrl+Shift+C apart from Ctrl+C", () => {
    const copy = { key: "c", mod: true, shift: true } as const;

    expect(matchesShortcut(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }), copy)).toBe(true);
    expect(matchesShortcut(keyEvent({ key: "c", ctrlKey: true }), copy)).toBe(false);
    expect(matchesShortcut(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }), { key: "c", mod: true })).toBe(false);
  });

  it("matches the key case-insensitively", () => {
    expect(matchesShortcut(keyEvent({ key: "H", ctrlKey: true }), { key: "h", mod: true })).toBe(true);
    expect(matchesShortcut(keyEvent({ key: "h", metaKey: true }), { key: "H", mod: true })).toBe(true);
  });

  it("rejects a different key", () => {
    expect(matchesShortcut(keyEvent({ key: "j", ctrlKey: true }), { key: "h", mod: true })).toBe(false);
  });
});
