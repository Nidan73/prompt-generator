import { describe, expect, it } from "vitest";
import { parseApiError } from "../../lib/home-errors";

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
