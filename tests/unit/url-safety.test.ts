import { describe, expect, it } from "vitest";
import {
  checkUrlSyntax,
  checkUrlWithDns,
  isPrivateAddress,
  isPrivateHostname,
  parseIpv4,
  parseIpv6,
  safeFetch,
} from "../../lib/url-safety";

describe("parseIpv4", () => {
  it("parses dotted quads", () => {
    expect(parseIpv4("127.0.0.1")).toEqual([127, 0, 0, 1]);
    expect(parseIpv4("255.255.255.255")).toEqual([255, 255, 255, 255]);
  });

  it("rejects non-quads and out-of-range octets", () => {
    expect(parseIpv4("127.0.0")).toBeNull();
    expect(parseIpv4("256.0.0.1")).toBeNull();
    expect(parseIpv4("example.com")).toBeNull();
  });
});

describe("parseIpv6", () => {
  it("expands :: to a full 16 bytes", () => {
    expect(parseIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("::")).toEqual(new Array(16).fill(0));
  });

  it("parses IPv4-mapped addresses in both spellings", () => {
    // WHATWG URL rewrites ::ffff:127.0.0.1 into this hex form.
    expect(parseIpv6("::ffff:7f00:1")?.slice(12)).toEqual([127, 0, 0, 1]);
    expect(parseIpv6("::ffff:127.0.0.1")?.slice(12)).toEqual([127, 0, 0, 1]);
  });

  it("rejects malformed input", () => {
    expect(parseIpv6("1:2:3::4::5")).toBeNull();
    expect(parseIpv6("gggg::1")).toBeNull();
    expect(parseIpv6("127.0.0.1")).toBeNull();
  });
});

describe("isPrivateAddress", () => {
  it("catches the usual private ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("catches IPv6 private ranges including the mapped-IPv4 bypass", () => {
    for (const address of ["::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:7f00:1"]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("allows public addresses", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });
});

describe("isPrivateHostname", () => {
  it("rejects loopback and internal suffixes", () => {
    expect(isPrivateHostname("localhost")).toBe(true);
    expect(isPrivateHostname("db.internal")).toBe(true);
    expect(isPrivateHostname("printer.lan")).toBe(true);
  });

  it("allows ordinary public names", () => {
    expect(isPrivateHostname("example.com")).toBe(false);
  });
});

describe("checkUrlSyntax", () => {
  it("normalises numeric IP encodings into blocked literals", () => {
    // WHATWG URL rewrites all of these to 127.0.0.1 before we see them.
    for (const url of [
      "http://2130706433/",
      "http://0x7f000001/",
      "http://0177.0.0.1/",
      "http://127.1/",
    ]) {
      expect(checkUrlSyntax(url), url).toMatchObject({ ok: false, reason: "private_host" });
    }
  });

  it("blocks the IPv4-mapped IPv6 form", () => {
    expect(checkUrlSyntax("http://[::ffff:127.0.0.1]/")).toMatchObject({
      ok: false,
      reason: "private_host",
    });
  });

  it("rejects non-http protocols and embedded credentials", () => {
    expect(checkUrlSyntax("file:///etc/passwd")).toMatchObject({
      ok: false,
      reason: "unsupported_protocol",
    });
    expect(checkUrlSyntax("http://user:pass@example.com/")).toMatchObject({
      ok: false,
      reason: "credentials_in_url",
    });
  });

  it("accepts a plain public URL", () => {
    expect(checkUrlSyntax("https://example.com/article")).toMatchObject({ ok: true });
  });
});

describe("checkUrlWithDns", () => {
  it("blocks a public name that resolves to a private address", async () => {
    // The nip.io bypass: hostname is public, resolution is not.
    const result = await checkUrlWithDns("http://10.0.0.1.nip.io/", async () => ["10.0.0.1"]);
    expect(result).toMatchObject({ ok: false, reason: "private_address" });
  });

  it("blocks when only one of several answers is private", async () => {
    const result = await checkUrlWithDns("http://split.example/", async () => [
      "93.184.216.34",
      "169.254.169.254",
    ]);
    expect(result).toMatchObject({ ok: false, reason: "private_address" });
  });

  it("blocks names that fail to resolve", async () => {
    const result = await checkUrlWithDns("http://nope.example/", async () => {
      throw new Error("ENOTFOUND");
    });
    expect(result).toMatchObject({ ok: false, reason: "private_host" });
  });

  it("allows a name resolving entirely to public addresses", async () => {
    const result = await checkUrlWithDns("https://example.com/", async () => ["93.184.216.34"]);
    expect(result).toMatchObject({ ok: true });
  });

  it("does not resolve IP literals", async () => {
    let called = false;
    const result = await checkUrlWithDns("http://93.184.216.34/", async () => {
      called = true;
      return [];
    });
    expect(result).toMatchObject({ ok: true });
    expect(called).toBe(false);
  });
});

describe("safeFetch", () => {
  const publicResolver = async () => ["93.184.216.34"];

  function stubFetch(responses: Response[]) {
    const calls: string[] = [];
    const original = globalThis.fetch;
    let index = 0;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return responses[index++] ?? new Response("done", { status: 200 });
    }) as typeof fetch;

    return { calls, restore: () => { globalThis.fetch = original; } };
  }

  it("refuses to follow a redirect into a private address", async () => {
    const stub = stubFetch([
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } }),
    ]);

    try {
      const result = await safeFetch("https://example.com/", {}, { resolver: publicResolver });
      expect(result).toMatchObject({ ok: false, reason: "private_host" });
      // The internal address must never have been requested.
      expect(stub.calls).toHaveLength(1);
      expect(stub.calls[0]).toContain("example.com");
    } finally {
      stub.restore();
    }
  });

  it("follows a public redirect and reports the final URL", async () => {
    const stub = stubFetch([
      new Response(null, { status: 301, headers: { location: "https://example.com/final" } }),
      new Response("hello", { status: 200 }),
    ]);

    try {
      const result = await safeFetch("https://example.com/start", {}, { resolver: publicResolver });
      expect(result).toMatchObject({ ok: true, finalUrl: "https://example.com/final" });
    } finally {
      stub.restore();
    }
  });

  it("gives up after too many redirects", async () => {
    const stub = stubFetch(
      new Array(6).fill(null).map(
        () => new Response(null, { status: 302, headers: { location: "https://example.com/loop" } }),
      ),
    );

    try {
      const result = await safeFetch(
        "https://example.com/loop",
        {},
        { resolver: publicResolver, maxRedirects: 2 },
      );
      expect(result).toMatchObject({ ok: false, reason: "too_many_redirects" });
    } finally {
      stub.restore();
    }
  });
});
