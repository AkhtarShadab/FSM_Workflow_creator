import { createHash } from "node:crypto";

const VOLATILE_TIMESTAMP_KEYS = new Set(["updatedAt", "createdAt"]);

/**
 * Stable JSON: object keys sorted recursively, array order preserved.
 * Volatile timestamps are kept (use `contentHash` to ignore them).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * SHA-256 hex of `canonicalJson` after stripping `updatedAt` / `createdAt`
 * at any depth. Node positions and other layout fields are included.
 */
export function contentHash(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(stripVolatileTimestamps(value)))
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const next = canonicalize(item);
      return next === undefined ? null : next;
    });
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const next = canonicalize(obj[key]);
    if (next !== undefined) {
      sorted[key] = next;
    }
  }
  return sorted;
}

function stripVolatileTimestamps(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(stripVolatileTimestamps);
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(obj)) {
    if (VOLATILE_TIMESTAMP_KEYS.has(key)) continue;
    out[key] = stripVolatileTimestamps(nested);
  }
  return out;
}
