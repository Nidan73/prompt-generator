import { describe, expect, it } from "vitest";
import { parseIpv6 } from "../../lib/ip-address";

describe("ip-address", () => {
  it("parses an IPv6 literal into 16 bytes", () => {
    expect(parseIpv6("2001:db8::1")).toEqual([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });
});
