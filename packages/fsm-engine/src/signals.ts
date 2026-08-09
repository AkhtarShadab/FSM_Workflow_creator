/** Parsed tool emission (FeatureShipping 001 §3.3) */
export interface StructuredEmission {
  signal: string;
  payload?: Record<string, unknown>;
  toHint?: string;
}

export type Emission = string | StructuredEmission;

export interface ParsedSignal {
  signal: string;
  payload: Record<string, unknown>;
  toHint?: string;
}

/**
 * Parse `::SCOPE.EVENT|key=value` grammar or a structured emission object.
 */
export function parseSignal(input: Emission): ParsedSignal {
  if (typeof input !== "string") {
    return {
      signal: input.signal,
      payload: input.payload ?? {},
      toHint: input.toHint,
    };
  }

  const [head, ...rest] = input.split("|");
  const signal = head.trim();
  const payload: Record<string, unknown> = {};
  let toHint: string | undefined;

  for (const part of rest) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    let raw = part.slice(eq + 1).trim();
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1);
    }
    if (key === "toHint") toHint = raw;
    else payload[key] = raw;
  }

  return { signal, payload, toHint };
}
