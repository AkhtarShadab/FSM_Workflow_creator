const SECRET_KEY =
  /^(api[_-]?key|authorization|secret|encrypted[_-]?key|password|bearer)$/i;

/** Defense in depth: never persist obvious secret fields on run events. */
export function sanitizeEventPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeEventPayload);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : sanitizeEventPayload(nested);
    }
    return out;
  }
  return value;
}

export function payloadContainsSecret(
  payload: unknown,
  secret: string
): boolean {
  if (!secret) return false;
  try {
    return JSON.stringify(payload).includes(secret);
  } catch {
    return false;
  }
}
