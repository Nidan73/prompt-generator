import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { classifyError, describeError } from "../../lib/api-observability";

describe("describeError", () => {
  it("returns only name, statusCode and errorType for provider errors", () => {
    const error = new APICallError({
      message: "boom SECRET",
      url: "https://x",
      requestBodyValues: { prompt: "SECRET PROMPT" },
      statusCode: 429,
      responseBody: "SECRET BODY",
    });
    const described = describeError(error);
    expect(described).toEqual({
      name: "AI_APICallError",
      statusCode: 429,
      errorType: "provider_rate_limit",
    });
    expect(JSON.stringify(described)).not.toContain("SECRET");
  });

  it("omits statusCode for plain errors", () => {
    const described = describeError(new Error("nope"));
    expect(described.name).toBe("Error");
    expect("statusCode" in described).toBe(false);
  });

  it("handles non-Error input", () => {
    const described = describeError("just a string SECRET");
    expect(described.name).toBe("NonError");
    expect(JSON.stringify(described)).not.toContain("SECRET");
  });
});

describe("classifyError status codes", () => {
  it("maps statusCode before message matching", () => {
    expect(classifyError(Object.assign(new Error("x"), { statusCode: 429 }))).toBe("provider_rate_limit");
    expect(classifyError(Object.assign(new Error("x"), { statusCode: 401 }))).toBe("auth");
    expect(classifyError(Object.assign(new Error("x"), { statusCode: 403 }))).toBe("auth");
    expect(classifyError(Object.assign(new Error("timeout"), { statusCode: 500 }))).toBe("timeout");
  });
});
