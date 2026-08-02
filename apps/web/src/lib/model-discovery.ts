/** Model discovery adapters (FeatureShipping 001 C3) */

export type DiscoveryProvider = "openai" | "anthropic" | "openai-compatible";

export interface DiscoveredModel {
  modelId: string;
  label: string;
}

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

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
}

async function discoverOpenAiCompatible(
  input: DiscoverInput
): Promise<DiscoverResult> {
  const fetchFn = input.fetchFn ?? fetch;
  const base = normalizeBase(input.baseUrl);
  try {
    const res = await fetchFn(`${base}/v1/models`, {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      data?: Array<{ id?: string; name?: string }>;
    };
    const models = (json.data ?? [])
      .map((m) => ({
        modelId: m.id ?? "",
        label: m.name ?? m.id ?? "",
      }))
      .filter((m) => m.modelId);
    return { ok: true, models };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function discoverAnthropic(input: DiscoverInput): Promise<DiscoverResult> {
  const fetchFn = input.fetchFn ?? fetch;
  const base = normalizeBase(input.baseUrl);
  try {
    const res = await fetchFn(`${base}/v1/models`, {
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) {
      // Anthropic may not expose /v1/models on all deployments — fall back catalog
      if (res.status === 404) {
        return {
          ok: true,
          models: [
            { modelId: "claude-sonnet-4-5", label: "claude-sonnet-4-5" },
            { modelId: "claude-opus-4-1", label: "claude-opus-4-1" },
            { modelId: "claude-haiku-4-5", label: "claude-haiku-4-5" },
          ],
        };
      }
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      data?: Array<{ id?: string; display_name?: string }>;
    };
    const models = (json.data ?? [])
      .map((m) => ({
        modelId: m.id ?? "",
        label: m.display_name ?? m.id ?? "",
      }))
      .filter((m) => m.modelId);
    return { ok: true, models };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Custom / manual: treat apiKey as unused; return empty until user lists models */
async function discoverCustom(input: DiscoverInput): Promise<DiscoverResult> {
  // openai-compatible path is preferred; custom without /v1/models returns empty ok
  void input;
  return { ok: true, models: [] };
}

export async function discoverModels(
  input: DiscoverInput
): Promise<DiscoverResult> {
  if (input.provider === "anthropic") return discoverAnthropic(input);
  if (input.provider === "openai" || input.provider === "openai-compatible") {
    return discoverOpenAiCompatible(input);
  }
  return discoverCustom(input);
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
