/**
 * SSRF guard for server-side fetches of user-supplied base URLs
 * (FeatureShipping 001 C3 — credential discovery).
 *
 * Blocks non-HTTP(S) schemes, localhost aliases, cloud metadata hosts,
 * and private / loopback / link-local IP literals. Callers on the server
 * should additionally resolve DNS and re-check each address with
 * `isPrivateAddress` (see the discover route).
 */

export type UrlGuardResult = { ok: true; url: URL } | { ok: false; error: string };

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);

const BLOCKED_HOST_SUFFIXES = [".localhost", ".internal", ".local"];

/** True when an IPv4/IPv6 literal is private, loopback, link-local, or otherwise non-public. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true; // this-net, private, loopback
    if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (v6.includes(":")) {
    const groups = expandIpv6(v6);
    if (!groups) return true; // unparseable IPv6 literal — fail closed
    const allZeroPrefix = (n: number) => groups.slice(0, n).every((g) => g === 0);
    // :: (unspecified) and ::1 (loopback)
    if (allZeroPrefix(7) && (groups[7] === 0 || groups[7] === 1)) return true;
    // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d (deprecated).
    // WHATWG URL normalises these to hex groups (e.g. [::ffff:7f00:1]),
    // so the embedded IPv4 must be re-derived from the last two groups.
    if (allZeroPrefix(5) && (groups[5] === 0xffff || groups[5] === 0)) {
      return isPrivateAddress(groupsToIpv4(groups[6], groups[7]));
    }
    // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 address
    if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
      return isPrivateAddress(groupsToIpv4(groups[6], groups[7]));
    }
    if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((groups[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
    if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((groups[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }
  return false;
}

function groupsToIpv4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** Expand an IPv6 literal (optionally with trailing dotted IPv4) to 8 groups. */
function expandIpv6(raw: string): number[] | null {
  let addr = raw;
  const v4Tail = addr.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4Tail) {
    const o = v4Tail.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    addr =
      addr.slice(0, -v4Tail[0].length) +
      `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const parts = addr.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (parts.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array(parts.length === 2 ? missing : 0).fill("0"), ...tail];
  const groups = all.map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  return groups.some(Number.isNaN) ? null : groups;
}

/** Hostname as DNS / `fetch` expect it — IPv6 literals without brackets. */
export function bareHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

/** Validate a user-supplied base URL for server-side fetching. */
export function validatePublicHttpUrl(raw: string): UrlGuardResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Only http(s) URLs are allowed" };
  }
  const host = url.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(host) ||
    BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))
  ) {
    return { ok: false, error: "Host is not allowed" };
  }
  if (isPrivateAddress(host)) {
    return { ok: false, error: "Private or internal addresses are not allowed" };
  }
  return { ok: true, url };
}
