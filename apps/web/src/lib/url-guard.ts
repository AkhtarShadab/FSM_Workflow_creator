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
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6.includes(":")) {
    if (v6 === "::" || v6 === "::1") return true; // unspecified, loopback
    if (v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd"))
      return true; // link-local, unique-local
    if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7)); // v4-mapped
    return false;
  }
  return false;
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
