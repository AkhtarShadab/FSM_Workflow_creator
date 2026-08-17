export type CredentialProvider = "openai" | "anthropic" | "openai-compatible";

export type CredentialDiscoveryStatus = "idle" | "ok" | "error";

export interface CredentialSummary {
  id: number;
  provider: CredentialProvider;
  label: string;
  baseUrl: string | null;
  last4: string;
  active: boolean;
  models: string[];
  discoveryStatus: CredentialDiscoveryStatus;
  discoveryError: string | null;
  discoveredAt: number | null;
}

export const CREDENTIAL_SUMMARY_KEYS = [
  "id",
  "provider",
  "label",
  "baseUrl",
  "last4",
  "active",
  "models",
  "discoveryStatus",
  "discoveryError",
  "discoveredAt",
] as const satisfies ReadonlyArray<keyof CredentialSummary>;

const PROVIDERS = new Set<CredentialProvider>([
  "openai",
  "anthropic",
  "openai-compatible",
]);

export function last4Of(plaintext: string): string {
  return plaintext.slice(-4);
}

export function asCredentialProvider(value: string): CredentialProvider {
  if (PROVIDERS.has(value as CredentialProvider)) {
    return value as CredentialProvider;
  }
  throw new Error("Invalid provider");
}

function asDiscoveryStatus(value: string | null): CredentialDiscoveryStatus {
  if (value === "ok" || value === "error" || value === "idle") return value;
  return "idle";
}

function toEpoch(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  return value;
}

function parseModels(modelsJson: string | null): string[] {
  if (!modelsJson) return [];
  try {
    const parsed: unknown = JSON.parse(modelsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

/** Map a credentials row to a client-safe summary. Never copies ciphertext or secrets. */
export function toCredentialSummary(row: {
  id: number;
  provider: string;
  label: string | null;
  baseUrl: string | null;
  last4: string;
  active: boolean;
  modelsJson: string | null;
  discoveryStatus: string | null;
  discoveryError: string | null;
  discoveredAt: Date | number | null;
}): CredentialSummary {
  return {
    id: row.id,
    provider: asCredentialProvider(row.provider),
    label: row.label ?? "",
    baseUrl: row.baseUrl,
    last4: row.last4,
    active: row.active,
    models: parseModels(row.modelsJson),
    discoveryStatus: asDiscoveryStatus(row.discoveryStatus),
    discoveryError: row.discoveryError,
    discoveredAt: toEpoch(row.discoveredAt),
  };
}
