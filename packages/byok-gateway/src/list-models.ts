import { ProviderError } from "./errors";
import type { DiscoveredModel, ListModelsInput, ProviderId } from "./types";

const ANTHROPIC_FALLBACK: DiscoveredModel[] = [
  { modelId: "claude-sonnet-4-5", label: "claude-sonnet-4-5" },
  { modelId: "claude-opus-4-1", label: "claude-opus-4-1" },
  { modelId: "claude-haiku-4-5", label: "claude-haiku-4-5" },
];

const MOCK_MODELS: DiscoveredModel[] = [
  { modelId: "mock-chat", label: "Mock Chat" },
];

export const DEFAULT_BASE_URL: Record<Exclude<ProviderId, "mock">, string | null> =
  {
    openai: "https://api.openai.com",
    anthropic: "https://api.anthropic.com",
    "openai-compatible": null,
  };

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function listModels(
  input: ListModelsInput
): Promise<DiscoveredModel[]> {
  if (input.provider === "mock" || process.env.FSM_MOCK_PROVIDER === "1") {
    return MOCK_MODELS;
  }
  const fetchFn = input.fetchFn ?? fetch;
  const fallback = DEFAULT_BASE_URL[input.provider];
  const baseUrl = input.baseUrl?.trim() || fallback;
  if (!baseUrl) {
    throw new Error("baseUrl is required for this provider");
  }
  const base = normalizeBaseUrl(baseUrl);

  if (input.provider === "anthropic") {
    return listAnthropic(fetchFn, base, input.key);
  }
  return listOpenAiCompatible(fetchFn, base, input.key);
}

async function listOpenAiCompatible(
  fetchFn: typeof fetch,
  base: string,
  key: string
): Promise<DiscoveredModel[]> {
  const res = await fetchFn(`${base}/v1/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ id?: string; name?: string }>;
  };
  return (json.data ?? [])
    .map((m) => ({
      modelId: m.id ?? "",
      label: m.name ?? m.id ?? "",
    }))
    .filter((m) => m.modelId);
}

async function listAnthropic(
  fetchFn: typeof fetch,
  base: string,
  key: string
): Promise<DiscoveredModel[]> {
  const res = await fetchFn(`${base}/v1/models`, {
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) {
    if (res.status === 404) return ANTHROPIC_FALLBACK;
    throw new Error(`HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ id?: string; display_name?: string }>;
  };
  return (json.data ?? [])
    .map((m) => ({
      modelId: m.id ?? "",
      label: m.display_name ?? m.id ?? "",
    }))
    .filter((m) => m.modelId);
}

export function httpStatusError(status: number): ProviderError {
  if (status === 401) return new ProviderError("AUTH_FAILED", 401);
  if (status === 429) {
    return new ProviderError("RATE_LIMITED", 429, { retryable: true });
  }
  return new ProviderError("PROVIDER_ERROR", status, {
    retryable: status >= 500,
  });
}
