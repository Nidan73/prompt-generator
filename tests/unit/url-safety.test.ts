import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  checkUrlSyntax,
  checkUrlWithDns,
  createValidatingLookup,
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

describe("isPrivateAddress IPv6 transition ranges", () => {
  it("judges the embedded IPv4 for NAT64 64:ff9b::/96", () => {
    expect(isPrivateAddress("64:ff9b::a9fe:a9fe")).toBe(true); // 169.254.169.254
    expect(isPrivateAddress("64:ff9b::7f00:1")).toBe(true); // 127.0.0.1
    expect(isPrivateAddress("64:ff9b::808:808")).toBe(false); // 8.8.8.8
  });

  it("blocks local-use NAT64 64:ff9b:1::/48", () => {
    expect(isPrivateAddress("64:ff9b:1::1")).toBe(true);
    expect(isPrivateAddress("64:ff9b:1:ffff::808:808")).toBe(true);
    expect(isPrivateAddress("64:ff9b:2::1")).toBe(false);
  });

  it("judges the embedded IPv4 for IPv4-translated ::ffff:0:a.b.c.d", () => {
    expect(isPrivateAddress("::ffff:0:a9fe:a9fe")).toBe(true);
    expect(isPrivateAddress("::ffff:0:7f00:1")).toBe(true);
    expect(isPrivateAddress("::ffff:0:808:808")).toBe(false);
  });

  it("blocks Teredo 2001::/32 but not neighbouring public space", () => {
    expect(isPrivateAddress("2001:0:4136:e378:8000:63bf:3fff:fdd2")).toBe(true);
    expect(isPrivateAddress("2001:0:4136::1")).toBe(true);
    expect(isPrivateAddress("2001:4860::8888")).toBe(false);
  });

  it("blocks ORCHID and ORCHIDv2", () => {
    expect(isPrivateAddress("2001:10::1")).toBe(true);
    expect(isPrivateAddress("2001:1f:ffff::1")).toBe(true);
    expect(isPrivateAddress("2001:20::1")).toBe(true);
    expect(isPrivateAddress("2001:2f::1")).toBe(true);
    expect(isPrivateAddress("2001:30::1")).toBe(false);
    expect(isPrivateAddress("2001:9::1")).toBe(false);
  });

  it("blocks documentation 2001:db8::/32", () => {
    expect(isPrivateAddress("2001:db8::1")).toBe(true);
    expect(isPrivateAddress("2001:db9::1")).toBe(false);
  });

  it("blocks deprecated site-local fec0::/10", () => {
    expect(isPrivateAddress("fec0::1")).toBe(true);
    expect(isPrivateAddress("feff::1")).toBe(true);
    expect(isPrivateAddress("ff00::1")).toBe(true);
    expect(isPrivateAddress("fe00::1")).toBe(false);
  });

  it("blocks transition addresses in URL form", () => {
    expect(checkUrlSyntax("http://[64:ff9b::a9fe:a9fe]/")).toMatchObject({
      ok: false,
      reason: "private_host",
    });
    expect(checkUrlSyntax("http://[64:ff9b::808:808]/")).toMatchObject({ ok: true });
  });
});

describe("createValidatingLookup", () => {
  const lookupAll = (lookup: ReturnType<typeof createValidatingLookup>, host: string) =>
    new Promise<{ err: NodeJS.ErrnoException | null; result: unknown }>((resolve) => {
      lookup(host, { all: true }, ((err: NodeJS.ErrnoException | null, result: unknown) =>
        resolve({ err, result })) as Parameters<typeof lookup>[2]);
    });

  const lookupOne = (lookup: ReturnType<typeof createValidatingLookup>, host: string) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address?: string; family?: number }>(
      (resolve) => {
        lookup(host, {}, ((err: NodeJS.ErrnoException | null, address?: string, family?: number) =>
          resolve({ err, address, family })) as Parameters<typeof lookup>[2]);
      },
    );

  it("fails with ESSRFBLOCKED when any answer is private (both forms)", async () => {
    const lookup = createValidatingLookup(async () => ["93.184.216.34", "127.0.0.1"]);

    const all = await lookupAll(lookup, "evil.example");
    expect(all.err?.code).toBe("ESSRFBLOCKED");

    const one = await lookupOne(lookup, "evil.example");
    expect(one.err?.code).toBe("ESSRFBLOCKED");
  });

  it("fails with ESSRFBLOCKED when resolution returns nothing", async () => {
    const lookup = createValidatingLookup(async () => []);
    expect((await lookupAll(lookup, "empty.example")).err?.code).toBe("ESSRFBLOCKED");
    expect((await lookupOne(lookup, "empty.example")).err?.code).toBe("ESSRFBLOCKED");
  });

  it("yields validated addresses with the right family in the all form", async () => {
    const lookup = createValidatingLookup(async () => ["93.184.216.34", "2606:4700::1111"]);
    const { err, result } = await lookupAll(lookup, "ok.example");
    expect(err).toBeNull();
    expect(result).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ]);
  });

  it("yields the first validated address with its family in the single form", async () => {
    const v6 = createValidatingLookup(async () => ["2606:4700::1111"]);
    expect(await lookupOne(v6, "ok.example")).toMatchObject({
      err: null,
      address: "2606:4700::1111",
      family: 6,
    });

    const v4 = createValidatingLookup(async () => ["93.184.216.34"]);
    expect(await lookupOne(v4, "ok.example")).toMatchObject({
      err: null,
      address: "93.184.216.34",
      family: 4,
    });
  });

  it("passes resolver failures to the callback", async () => {
    const lookup = createValidatingLookup(async () => {
      throw new Error("ENOTFOUND");
    });
    expect((await lookupOne(lookup, "nope.example")).err).toBeInstanceOf(Error);
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

  // safeFetch uses undici's own fetch, so tests inject the transport instead of patching globalThis.
  function stubFetch(responses: Response[]) {
    const calls: string[] = [];
    let index = 0;

    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return responses[index++] ?? new Response("done", { status: 200 });
    }) as unknown as typeof fetch;

    return { calls, fetchImpl };
  }

  it("refuses to follow a redirect into a private address", async () => {
    const stub = stubFetch([
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } }),
    ]);

    const result = await safeFetch(
      "https://example.com/",
      {},
      { resolver: publicResolver, fetchImpl: stub.fetchImpl },
    );
    expect(result).toMatchObject({ ok: false, reason: "private_host" });
    // The internal address must never have been requested.
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]).toContain("example.com");
  });

  it("follows a public redirect and reports the final URL", async () => {
    const stub = stubFetch([
      new Response(null, { status: 301, headers: { location: "https://example.com/final" } }),
      new Response("hello", { status: 200 }),
    ]);

    const result = await safeFetch(
      "https://example.com/start",
      {},
      { resolver: publicResolver, fetchImpl: stub.fetchImpl },
    );
    expect(result).toMatchObject({ ok: true, finalUrl: "https://example.com/final" });
  });

  it("gives up after too many redirects", async () => {
    const stub = stubFetch(
      new Array(6).fill(null).map(
        () => new Response(null, { status: 302, headers: { location: "https://example.com/loop" } }),
      ),
    );

    const result = await safeFetch(
      "https://example.com/loop",
      {},
      { resolver: publicResolver, maxRedirects: 2, fetchImpl: stub.fetchImpl },
    );
    expect(result).toMatchObject({ ok: false, reason: "too_many_redirects" });
  });
});

describe("safeFetch connection pinning", () => {
  it("does not let a rebound DNS answer reach a loopback server", async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests += 1;
      res.end("internal secret");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    // Public on the validation lookup, loopback for every later lookup.
    let calls = 0;
    const rebinding = async () => (calls++ === 0 ? ["93.184.216.34"] : ["127.0.0.1"]);

    try {
      const result = await safeFetch(
        `http://rebind.test:${port}/`,
        { signal: AbortSignal.timeout(5000) },
        { resolver: rebinding },
      );
      expect(result).toMatchObject({ ok: false });
      expect(requests).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
