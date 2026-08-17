/** Shared mask helper (mirrors apps/web isStateDisabledByMask) */
export function isStateDisabledByMask(
  stateId: string,
  mask: { enabledStateIds: string[]; disabledStateIds: string[] }
): boolean {
  if (mask.disabledStateIds.includes(stateId)) return true;
  if (
    mask.enabledStateIds.length > 0 &&
    !mask.enabledStateIds.includes(stateId)
  ) {
    return true;
  }
  return false;
}

/** Tool schema loaded into the runtime registry for the active cluster. */
export interface ToolSchema {
  name: string;
  schema?: unknown;
  stateId?: string;
}

export interface MaskSwapResult {
  /** Registry after the swap — exactly the next cluster's schemas. */
  loaded: ToolSchema[];
  /** Finished-cluster schemas removed from the previous registry. */
  unloaded: ToolSchema[];
}

function schemaKey(s: ToolSchema): string {
  return s.stateId ? `${s.stateId}::${s.name}` : s.name;
}

/**
 * Runtime tool-schema swap at a SYSTEM_FUNCTION boundary (011 T2 / §7.2).
 *
 * Unloads the finished cluster's schemas and replaces the registry with
 * exactly the next cluster's schemas (not a union).
 */
export function swapToolSchemas(
  current: readonly ToolSchema[],
  finished: readonly ToolSchema[],
  next: readonly ToolSchema[]
): MaskSwapResult {
  const finishedKeys = new Set(finished.map(schemaKey));
  const finishedNames = new Set(finished.map((s) => s.name));
  const nextKeys = new Set(next.map(schemaKey));

  const unloaded = current.filter(
    (s) =>
      finishedKeys.has(schemaKey(s)) ||
      finishedNames.has(s.name) ||
      !nextKeys.has(schemaKey(s))
  );

  // Deduplicate by key while preserving current order.
  const seen = new Set<string>();
  const unloadedUnique: ToolSchema[] = [];
  for (const s of unloaded) {
    const k = schemaKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    unloadedUnique.push({ ...s });
  }

  return {
    loaded: next.map((s) => ({ ...s })),
    unloaded: unloadedUnique,
  };
}
