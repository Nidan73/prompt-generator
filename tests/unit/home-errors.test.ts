import { describe, expect, it } from "vitest";
import { formatWait, planRateLimit, parseApiError } from "../../lib/home-errors";

describe("parseApiError", () => {
  it("reads error and retryAfter from a JSON message", () => {
    const error = new Error(
      JSON.stringify({ error: "Too many requests.", retryAfter: 30 }),
    );

    expect(parseApiError(error)).toEqual({
      message: "Too many requests.",
      retryAfter: 30,
    });
  });

  it("returns only the message when retryAfter is missing", () => {
    const error = new Error(JSON.stringify({ error: "Prompt is too long." }));

    expect(parseApiError(error)).toEqual({ message: "Prompt is too long." });
  });

  it("ignores a retryAfter that is not a number", () => {
    const error = new Error(
      JSON.stringify({ error: "Slow down.", retryAfter: "soon" }),
    );

    expect(parseApiError(error)).toEqual({ message: "Slow down." });
  });

  it("returns nothing for a message that is not JSON", () => {
    expect(parseApiError(new Error("Failed to fetch"))).toEqual({});
  });

  it("returns nothing for JSON that is not an object", () => {
    expect(parseApiError(new Error("null"))).toEqual({});
    expect(parseApiError(new Error("42"))).toEqual({});
  });

  it("returns nothing for input that is not an Error", () => {
    expect(parseApiError("boom")).toEqual({});
    expect(parseApiError(undefined)).toEqual({});
    expect(parseApiError({ error: "x", retryAfter: 5 })).toEqual({});
  });
});

describe("formatWait", () => {
  it.each([
    [45, "45 s"],
    [119, "119 s"],
    [120, "about 2 min"],
    [3599, "about 60 min"],
    [3600, "about 1 h"],
    [3900, "about 1 h 5 min"],
    [40000, "about 11 h 7 min"],
    [43200, "about 12 h"],
  ])("formats %i seconds as %s", (seconds, expected) => {
    expect(formatWait(seconds)).toBe(expected);
  });
});

describe("planRateLimit", () => {
  it("starts the global cooldown for a short wait", () => {
    expect(planRateLimit({ message: "Slow down.", retryAfter: 30 })).toEqual({
      cooldownSeconds: 30,
    });
    expect(planRateLimit({ retryAfter: 120 })).toEqual({ cooldownSeconds: 120 });
  });

  it("shows the server text and the wait for a long wait without a cooldown", () => {
    expect(
      planRateLimit({
        message: "Daily limit reached for this feature. Please try again tomorrow.",
        retryAfter: 43200,
      }),
    ).toEqual({
      message:
        "Daily limit reached for this feature. Please try again tomorrow. Try again in about 12 h.",
    });
  });

  it("falls back to a generic message when the server sent no text", () => {
    expect(planRateLimit({ retryAfter: 121 })).toEqual({
      message: "Limit reached. Try again in about 3 min.",
    });
  });

  it("returns null when there is no retryAfter", () => {
    expect(planRateLimit({ message: "Bad." })).toBeNull();
  });
});
