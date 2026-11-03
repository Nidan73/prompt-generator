import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctor = vi.hoisted(() => vi.fn());

vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor(config: unknown) {
      ctor(config);
    }
  },
}));

import { redisFromEnvOrNull } from "../../lib/redis-env";

const NAMES = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const;

describe("redisFromEnvOrNull", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    ctor.mockClear();
    for (const n of NAMES) {
      saved[n] = process.env[n];
      process.env[n] = "";
    }
  });

  afterEach(() => {
    for (const n of NAMES) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  });

  it("returns null and builds no client when every variable is an empty string", () => {
    expect(redisFromEnvOrNull()).toBeNull();
    expect(ctor).not.toHaveBeenCalled();
  });

  it("returns null when only the url or only the token is set", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
    expect(redisFromEnvOrNull()).toBeNull();
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "t";
    expect(redisFromEnvOrNull()).toBeNull();
    expect(ctor).not.toHaveBeenCalled();
  });

  it("returns a client from the Upstash names", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://u.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "ut";
    expect(redisFromEnvOrNull()).not.toBeNull();
    expect(ctor).toHaveBeenCalledWith({ url: "https://u.upstash.io", token: "ut" });
  });

  it("falls back to the KV names when the Upstash names are empty", () => {
    process.env.KV_REST_API_URL = "https://k.upstash.io";
    process.env.KV_REST_API_TOKEN = "kt";
    expect(redisFromEnvOrNull()).not.toBeNull();
    expect(ctor).toHaveBeenCalledWith({ url: "https://k.upstash.io", token: "kt" });
  });

  it("prefers the Upstash names over the KV names", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://u.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "ut";
    process.env.KV_REST_API_URL = "https://k.upstash.io";
    process.env.KV_REST_API_TOKEN = "kt";
    redisFromEnvOrNull();
    expect(ctor).toHaveBeenCalledWith({ url: "https://u.upstash.io", token: "ut" });
  });
});
