import { APICallError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exec = vi.fn(async () => []);
const pipelineStub = { incr: vi.fn(), incrby: vi.fn(), expire: vi.fn(), exec };

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => ({ pipeline: () => pipelineStub }) },
}));

// Throwing forces trackApiEvent onto its synchronous fallback path.
vi.mock("next/server", () => ({
  after: () => {
    throw new Error("outside request scope");
  },
}));

import {
  classifyError,
  describeError,
  normalizeClientKey,
  trackApiEvent,
} from "../../lib/api-observability";

describe("normalizeClientKey", () => {
  it("keeps IPv4 as is", () => {
    expect(normalizeClientKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("unwraps IPv4-mapped IPv6", () => {
    expect(normalizeClientKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("reduces a full IPv6 address to its /64", () => {
    expect(normalizeClientKey("2001:0db8:abcd:0012:1111:2222:3333:4444")).toBe(
      "2001:db8:abcd:12::/64",
    );
  });

  it("reduces a compressed IPv6 address to its /64", () => {
    expect(normalizeClientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });

  it("lowercases hex", () => {
    expect(normalizeClientKey("2001:DB8:ABCD:12::5")).toBe("2001:db8:abcd:12::/64");
  });

  it("returns unparseable values trimmed", () => {
    expect(normalizeClientKey("  not-an-ip  ")).toBe("not-an-ip");
  });
});

describe("trackApiEvent persistence", () => {
  beforeEach(() => {
    exec.mockClear();
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  });

  it("writes counters by default", async () => {
    trackApiEvent({ route: "t", event: "e", status: 200 });
    await new Promise((r) => setTimeout(r, 0));
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("skips Redis when persist is false", async () => {
    trackApiEvent({ route: "t", event: "validation_failed", status: 400 }, { persist: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(exec).not.toHaveBeenCalled();
  });
});

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

describe("classifyError invalid output", () => {
  it("labels unusable clarify output", async () => {
    const { InvalidOutputError } = await import("../../lib/clarify-questions");
    expect(classifyError(new InvalidOutputError("Provider returned fewer than 3 usable questions."))).toBe(
      "invalid_output",
    );
  });
});
