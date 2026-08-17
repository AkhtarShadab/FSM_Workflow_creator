/** Model discovery adapters (FeatureShipping 001 C3) — listModels lives in @fsm/byok-gateway */

import {
  listModels as gatewayListModels,
  type DiscoveredModel,
} from "@fsm/byok-gateway";

export type DiscoveryProvider = "openai" | "anthropic" | "openai-compatible";

export type { DiscoveredModel };

export interface DiscoverInput {
  provider: DiscoveryProvider;
  baseUrl: string;
  apiKey: string;
  /** Injected for tests */
  fetchFn?: typeof fetch;
}

export type DiscoverResult =
  | { ok: true; models: DiscoveredModel[] }
  | { ok: false; error: string };

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export function isDiscoveryStale(
  discoveredAt: number | null | undefined,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now()
): boolean {
  if (discoveredAt == null) return true;
  return now - discoveredAt > ttlMs;
}

export async function discoverModels(
  input: DiscoverInput
): Promise<DiscoverResult> {
  try {
    const models = await gatewayListModels({
      provider: input.provider,
      key: input.apiKey,
      baseUrl: input.baseUrl,
      fetchFn: input.fetchFn,
    });
    return { ok: true, models };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Merge models from multiple credentials into a union list */
export function unionDiscoveredModels(
  entries: Array<{
    credentialId: string;
    label: string;
    models: string[];
    active: boolean;
  }>
): Array<{ credentialId: string; modelId: string; label: string }> {
  const out: Array<{ credentialId: string; modelId: string; label: string }> =
    [];
  for (const e of entries) {
    if (!e.active) continue;
    for (const m of e.models) {
      out.push({
        credentialId: e.credentialId,
        modelId: m,
        label: `${e.label} · ${m}`,
      });
    }
  }
  return out;
}
