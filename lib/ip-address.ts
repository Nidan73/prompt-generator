/**
 * Dependency-free IP literal parsing and range checks, shared by the SSRF guard
 * and the client-key normaliser so neither has to load undici.
 */

/** Dotted-quad only, WHATWG URL has already normalised decimal/octal/hex forms. */
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

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible, judge the embedded IPv4.
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
