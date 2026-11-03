/**
 * SSRF Guards for User-Supplied URLs
 *
 * /api/extract fetches whatever URL a user hands it, which makes this server a
 * confused deputy unless the target is checked properly.
 *
 * String-matching the hostname is not enough. Two bypasses that a
 * `startsWith("127.")`-style blocklist lets through:
 *
 *   - `http://10.0.0.1.nip.io/`   hostname is a public DNS name; it resolves to 10.0.0.1
 *   - `http://[::ffff:127.0.0.1]/` WHATWG normalises this to `[::ffff:7f00:1]`, which
 *                                  matches none of the textual IPv6 prefixes
 *
 * So: parse addresses into bytes and range-check them, and for DNS names resolve
 * first and check every address the name resolves to. Redirects get the same
 * treatment per hop, because following a redirect is another outbound request.
 *
 * DNS rebinding (a name that answers with a public IP for our check and a private
 * IP for the real connect) is closed by safeFetch: it uses undici's own fetch with
 * an Agent whose connect.lookup validates the answer it hands to the socket, so the
 * address that was checked is the address that gets connected.
 */

import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

// ─── Address Parsing ───────────────────────────────────────────────────────────

/** Dotted-quad only — WHATWG URL has already normalised decimal/octal/hex forms. */
export function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;

  const bytes: number[] = [];

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }

  return bytes;
}

/** Returns 16 bytes, or null when `host` is not an IPv6 literal. */
export function parseIpv6(host: string): number[] | null {
  const raw = host.replace(/^\[|\]$/g, "");
  if (!raw.includes(":")) return null;

  // A trailing dotted-quad (::ffff:127.0.0.1) contributes the final two groups.
  let head = raw;
  let tailBytes: number[] = [];
  const lastColon = raw.lastIndexOf(":");
  const maybeIpv4 = raw.slice(lastColon + 1);

  if (maybeIpv4.includes(".")) {
    const parsed = parseIpv4(maybeIpv4);
    if (!parsed) return null;
    tailBytes = parsed;
    head = raw.slice(0, lastColon);
  }

  const halves = head.split("::");
  if (halves.length > 2) return null;

  const toGroups = (segment: string): number[][] | null => {
    if (segment === "") return [];
    const groups: number[][] = [];

    for (const group of segment.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      const value = Number.parseInt(group, 16);
      groups.push([value >> 8, value & 0xff]);
    }

    return groups;
  };

  const left = toGroups(halves[0] ?? "");
  const right = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  if (!left || !right) return null;

  const leftBytes = left.flat();
  const rightBytes = right.flat();
  const fixed = leftBytes.length + rightBytes.length + tailBytes.length;
  if (fixed > 16) return null;

  const gap = 16 - fixed;
  // Without "::" the address must already be complete.
  if (halves.length === 1 && gap !== 0) return null;
  if (halves.length === 2 && gap === 0) return null;

  return [...leftBytes, ...new Array(gap).fill(0), ...rightBytes, ...tailBytes];
}

// ─── Range Checks ──────────────────────────────────────────────────────────────

/** Anything not routable on the public internet, plus the cloud metadata range. */
export function isPrivateIpv4(bytes: number[]): boolean {
  const [a, b] = bytes;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast

  return false;
}

export function isPrivateIpv6(bytes: number[]): boolean {
  const allZero = bytes.every((byte) => byte === 0);
  if (allZero) return true; // ::

  const isLoopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  if (isLoopback) return true; // ::1

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — judge the embedded IPv4.
  const first10Zero = bytes.slice(0, 10).every((byte) => byte === 0);
  if (first10Zero && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPrivateIpv4(bytes.slice(12));
  }
  if (first10Zero && bytes[10] === 0 && bytes[11] === 0) {
    return isPrivateIpv4(bytes.slice(12));
  }

  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true; // multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return true; // 2002::/16 6to4
  if (bytes[0] === 0x01 && bytes[1] === 0x00) return true; // 100::/64 discard-only
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true; // fec0::/10 deprecated site-local

  // 64:ff9b::/96 NAT64: the gateway connects to the embedded IPv4, so judge that.
  const isNat64Prefix =
    bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b;
  if (isNat64Prefix && bytes.slice(4, 12).every((byte) => byte === 0)) {
    return isPrivateIpv4(bytes.slice(12));
  }
  if (isNat64Prefix && bytes[4] === 0x00 && bytes[5] === 0x01) return true; // 64:ff9b:1::/48 local-use NAT64

  // ::ffff:0:a.b.c.d IPv4-translated (SIIT): judge the embedded IPv4.
  const isTranslated =
    bytes.slice(0, 8).every((byte) => byte === 0) &&
    bytes[8] === 0xff &&
    bytes[9] === 0xff &&
    bytes[10] === 0 &&
    bytes[11] === 0;
  if (isTranslated) return isPrivateIpv4(bytes.slice(12));

  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    if (bytes[2] === 0x00 && bytes[3] === 0x00) return true; // 2001::/32 Teredo
    if (bytes[2] === 0x00 && ((bytes[3] & 0xf0) === 0x10 || (bytes[3] & 0xf0) === 0x20)) {
      return true; // 2001:10::/28 ORCHID and 2001:20::/28 ORCHIDv2
    }
    if (bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // 2001:db8::/32 documentation
  }

  return false;
}

/** True when `address` is an IP literal pointing somewhere non-public. */
export function isPrivateAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) return isPrivateIpv4(ipv4);

  const ipv6 = parseIpv6(address);
  if (ipv6) return isPrivateIpv6(ipv6);

  return false;
}

/** Hostnames that never belong to the public internet regardless of resolution. */
const PRIVATE_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".home.arpa",
  ".corp",
  ".intranet",
];

export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost") return true;
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return isPrivateAddress(host);
}

// ─── URL-Level Checks ──────────────────────────────────────────────────────────

export type UrlRejection =
  | "invalid_url"
  | "unsupported_protocol"
  | "credentials_in_url"
  | "private_host"
  | "private_address"
  | "too_many_redirects";

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: UrlRejection };

/**
 * The checks that need no network: protocol, embedded credentials, and any
 * hostname that is already an obviously private literal or suffix.
 */
export function checkUrlSyntax(rawUrl: string): UrlCheck {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "unsupported_protocol" };
  }

  // user:pass@host would leak into upstream requests and confuses host parsing.
  if (url.username || url.password) {
    return { ok: false, reason: "credentials_in_url" };
  }

  if (isPrivateHostname(url.hostname)) {
    return { ok: false, reason: "private_host" };
  }

  return { ok: true, url };
}

/**
 * Resolve a hostname and reject if *any* answer is non-public. Injected so the
 * unit tests can drive it without real DNS, and so the module still imports on
 * runtimes without node:dns.
 */
export type HostResolver = (hostname: string) => Promise<string[]>;

export const resolveHostAddresses: HostResolver = async (hostname) => {
  const { lookup } = await import("node:dns/promises");
  const results = await lookup(hostname, { all: true });
  return results.map((result) => result.address);
};

export async function checkUrlWithDns(
  rawUrl: string,
  resolver: HostResolver = resolveHostAddresses,
): Promise<UrlCheck> {
  const syntax = checkUrlSyntax(rawUrl);
  if (!syntax.ok) return syntax;

  const hostname = syntax.url.hostname.replace(/^\[|\]$/g, "");

  // Literals were already range-checked by checkUrlSyntax; no lookup needed.
  if (parseIpv4(hostname) || parseIpv6(hostname)) return syntax;

  let addresses: string[];

  try {
    addresses = await resolver(hostname);
  } catch {
    // A name we cannot resolve is a name we should not fetch.
    return { ok: false, reason: "private_host" };
  }

  if (addresses.length === 0) return { ok: false, reason: "private_host" };
  if (addresses.some(isPrivateAddress)) {
    return { ok: false, reason: "private_address" };
  }

  return syntax;
}

// ─── Connection Pinning ────────────────────────────────────────────────────────

type LookupAddress = { address: string; family: 4 | 6 };

// Same shape net.connect expects; it passes options.all when it wants every address.
export type ValidatingLookup = LookupFunction;

function blockedError(message: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = "ESSRFBLOCKED";
  return error;
}

/**
 * A socket lookup that only ever returns addresses it has just validated. The
 * connection uses this answer directly, so a later (rebound) DNS answer cannot
 * redirect the socket to an internal host.
 */
export function createValidatingLookup(resolver: HostResolver): ValidatingLookup {
  return (hostname, options, lookupCallback) => {
    const wantsAll = options.all === true;
    // The declared callback type has no error arm, but node accepts (err) alone.
    const callback = lookupCallback as (
      err: NodeJS.ErrnoException | null,
      addressOrList?: string | LookupAddress[],
      family?: number,
    ) => void;

    resolver(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          callback(blockedError(`No addresses resolved for ${hostname}`));
          return;
        }
        if (addresses.some(isPrivateAddress)) {
          callback(blockedError(`${hostname} resolves to a non-public address`));
          return;
        }

        const validated: LookupAddress[] = addresses.map((address) => ({
          address,
          family: parseIpv4(address) ? 4 : 6,
        }));

        if (wantsAll) callback(null, validated);
        else callback(null, validated[0].address, validated[0].family);
      },
      (error: NodeJS.ErrnoException) => callback(error),
    );
  };
}

function isBlockedByLookup(error: unknown): boolean {
  // undici wraps socket errors as TypeError("fetch failed") with the cause chain.
  for (let current = error, depth = 0; current && depth < 5; depth += 1) {
    if ((current as NodeJS.ErrnoException).code === "ESSRFBLOCKED") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

// ─── Guarded Fetch ─────────────────────────────────────────────────────────────

export const MAX_REDIRECTS = 3;

export type SafeFetchResult =
  | { ok: true; response: Response; finalUrl: string; dispose: () => void }
  | { ok: false; reason: UrlRejection };

/**
 * fetch() with every redirect hop validated before it is followed, and every
 * connection pinned to an address validated at connect time.
 *
 * `redirect: "follow"` cannot work here: by the time the final URL is available
 * the internal request has already been issued, which is exactly the side effect
 * an SSRF guard exists to prevent.
 *
 * Agent lifecycle: one Agent per safeFetch call, shared by its redirect hops and
 * released by the caller through `dispose` once the body has been read. The body
 * is streamed after safeFetch returns, so closing here would cut it off, and a
 * keepAliveTimeout trick would leave idle sockets to a per-call pool for no gain.
 * On every non-ok path safeFetch disposes the Agent itself.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit & { signal?: AbortSignal },
  options: { resolver?: HostResolver; maxRedirects?: number; fetchImpl?: typeof fetch } = {},
): Promise<SafeFetchResult> {
  const {
    resolver = resolveHostAddresses,
    maxRedirects = MAX_REDIRECTS,
    fetchImpl = undiciFetch as unknown as typeof fetch,
  } = options;

  const agent = new Agent({ connect: { lookup: createValidatingLookup(resolver) } });
  const dispose = () => {
    void agent.destroy().catch(() => undefined);
  };

  try {
    let currentUrl = rawUrl;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const check = await checkUrlWithDns(currentUrl, resolver);
      if (!check.ok) {
        dispose();
        return check;
      }

      let response: Response;

      try {
        response = await fetchImpl(check.url.toString(), {
          ...init,
          redirect: "manual",
          dispatcher: agent,
        } as RequestInit);
      } catch (error) {
        // The lookup refused a rebound or otherwise non-public answer.
        if (isBlockedByLookup(error)) {
          dispose();
          return { ok: false, reason: "private_address" };
        }
        throw error;
      }

      const location = response.headers.get("location");

      if (!isRedirect(response.status) || !location) {
        return { ok: true, response, finalUrl: check.url.toString(), dispose };
      }

      // Release the redirect body before moving on.
      await response.body?.cancel().catch(() => undefined);
      currentUrl = new URL(location, check.url).toString();
    }

    dispose();
    return { ok: false, reason: "too_many_redirects" };
  } catch (error) {
    dispose();
    throw error;
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
