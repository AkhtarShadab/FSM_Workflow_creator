"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  createCredential as createCredentialAction,
  listCredentials,
  rotateCredential as rotateCredentialAction,
  revokeCredential as revokeCredentialAction,
} from "@/app/settings/credentials/actions";
import {
  asCredentialProvider,
  type CredentialProvider,
  type CredentialSummary,
} from "@/lib/credentials/types";

export type { CredentialSummary };
/** @deprecated use CredentialSummary — kept so inspector/nav imports keep compiling */
export type CredentialEntry = CredentialSummary;
export type DiscoveryStatus =
  | CredentialSummary["discoveryStatus"]
  | "discovering";

export const CREDENTIAL_STORE_NAME = "fsm-credential-store";
export const CREDENTIAL_STORE_VERSION = 2;

export interface PersistedCredentialState {
  credentials: CredentialSummary[];
  activeId: number | null;
  showReentryBanner: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Recursively delete any `apiKey` field from previously persisted state. */
export function deleteApiKeyFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deleteApiKeyFields);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "apiKey") continue;
    out[key] = deleteApiKeyFields(nested);
  }
  return out;
}

export function persistedContainsApiKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(persistedContainsApiKey);
  if (!isRecord(value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, "apiKey")) return true;
  return Object.values(value).some(persistedContainsApiKey);
}

function asDiscoveryStatus(
  value: unknown
): CredentialSummary["discoveryStatus"] {
  if (value === "ok" || value === "error" || value === "idle") return value;
  return "idle";
}

export function toCredentialSummaryShape(
  raw: unknown
): CredentialSummary | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "number" ? raw.id : Number(raw.id);
  if (!Number.isInteger(id) || id < 1) return null;
  let provider: CredentialProvider;
  try {
    provider = asCredentialProvider(
      typeof raw.provider === "string" ? raw.provider : ""
    );
  } catch {
    return null;
  }
  const models = Array.isArray(raw.models)
    ? raw.models.filter((item): item is string => typeof item === "string")
    : [];
  return {
    id,
    provider,
    label: typeof raw.label === "string" && raw.label ? raw.label : "key",
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : null,
    last4: typeof raw.last4 === "string" ? raw.last4 : "",
    active: typeof raw.active === "boolean" ? raw.active : true,
    models,
    discoveryStatus: asDiscoveryStatus(raw.discoveryStatus),
    discoveryError:
      typeof raw.discoveryError === "string" ? raw.discoveryError : null,
    discoveredAt: typeof raw.discoveredAt === "number" ? raw.discoveredAt : null,
  };
}

export function pickSummaryFields(
  summary: CredentialSummary
): CredentialSummary {
  return {
    id: summary.id,
    provider: summary.provider,
    label: summary.label,
    baseUrl: summary.baseUrl,
    last4: summary.last4,
    active: summary.active,
    models: [...summary.models],
    discoveryStatus: summary.discoveryStatus,
    discoveryError: summary.discoveryError,
    discoveredAt: summary.discoveredAt,
  };
}

function asActiveId(
  value: unknown,
  credentials: CredentialSummary[]
): number | null {
  const id = typeof value === "number" ? value : Number(value);
  if (Number.isInteger(id) && id >= 1 && credentials.some((c) => c.id === id)) {
    return id;
  }
  return credentials.find((c) => c.active)?.id ?? null;
}

/**
 * Zustand persist v1→v2: drop plaintext keys and anything that is not a
 * CredentialSummary. Legacy `cred_*` ids cannot be mapped to server rows.
 */
export function migrateCredentialPersist(
  persisted: unknown,
  _fromVersion: number
): PersistedCredentialState {
  const hadApiKey = persistedContainsApiKey(persisted);
  const scrubbed = deleteApiKeyFields(persisted);
  const record = isRecord(scrubbed) ? scrubbed : {};
  const rawList = Array.isArray(record.credentials) ? record.credentials : [];
  const credentials = rawList
    .map(toCredentialSummaryShape)
    .filter((c): c is CredentialSummary => c != null)
    .map(pickSummaryFields);
  const droppedLegacy = rawList.length > credentials.length;
  const existingBanner =
    typeof record.showReentryBanner === "boolean"
      ? record.showReentryBanner
      : false;
  return {
    credentials,
    activeId: asActiveId(record.activeId, credentials),
    showReentryBanner: hadApiKey || droppedLegacy || existingBanner,
  };
}

function actionMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

interface CredentialStore extends PersistedCredentialState {
  loaded: boolean;
  loadError: string | null;
  hydrate: () => Promise<void>;
  addCredential: (input: {
    provider: CredentialProvider;
    label: string;
    baseUrl?: string | null;
    apiKey: string;
  }) => Promise<CredentialSummary>;
  rotateCredential: (
    id: number,
    newApiKey: string
  ) => Promise<CredentialSummary>;
  revokeCredential: (id: number) => Promise<CredentialSummary>;
  upsertCredential: (summary: CredentialSummary) => void;
  setModels: (
    id: number,
    models: string[],
    meta?: {
      status: CredentialSummary["discoveryStatus"];
      error?: string | null;
      discoveredAt?: number | null;
    }
  ) => void;
  toggleActive: (id: number, on?: boolean) => void;
  /** @deprecated use toggleActive — kept for nav badge compat */
  setActive: (id: number | null) => void;
  dismissReentryBanner: () => void;
}

export const useCredentialStore = create<CredentialStore>()(
  persist(
    (set, get) => ({
      credentials: [],
      activeId: null,
      showReentryBanner: false,
      loaded: false,
      loadError: null,

      hydrate: async () => {
        try {
          const list = await listCredentials();
          const credentials = list.map(pickSummaryFields);
          set((state) => ({
            credentials,
            loaded: true,
            loadError: null,
            activeId: asActiveId(state.activeId, credentials),
          }));
        } catch (err) {
          set({ loaded: true, loadError: actionMessage(err) });
        }
      },

      addCredential: async (input) => {
        const summary = pickSummaryFields(await createCredentialAction(input));
        set((state) => {
          const credentials = [
            summary,
            ...state.credentials.filter((c) => c.id !== summary.id),
          ];
          return {
            credentials,
            activeId: state.activeId ?? summary.id,
          };
        });
        return summary;
      },

      rotateCredential: async (id, newApiKey) => {
        const summary = pickSummaryFields(
          await rotateCredentialAction(id, newApiKey)
        );
        get().upsertCredential(summary);
        return summary;
      },

      revokeCredential: async (id) => {
        const summary = pickSummaryFields(await revokeCredentialAction(id));
        set((state) => ({
          credentials: state.credentials.map((c) =>
            c.id === id ? summary : c
          ),
          activeId: state.activeId === id ? null : state.activeId,
        }));
        return summary;
      },

      upsertCredential: (summary) => {
        const next = pickSummaryFields(summary);
        set((state) => ({
          credentials: state.credentials.some((c) => c.id === next.id)
            ? state.credentials.map((c) => (c.id === next.id ? next : c))
            : [next, ...state.credentials],
        }));
      },

      setModels: (id, models, meta) =>
        set((state) => ({
          credentials: state.credentials.map((c) =>
            c.id === id
              ? pickSummaryFields({
                  ...c,
                  models,
                  discoveryStatus: meta?.status ?? "ok",
                  discoveryError:
                    meta?.error === undefined ? c.discoveryError : meta.error,
                  discoveredAt:
                    meta?.discoveredAt === undefined
                      ? Date.now()
                      : meta.discoveredAt,
                })
              : c
          ),
        })),

      toggleActive: (id, on) =>
        set((state) => {
          const next = state.credentials.map((c) =>
            c.id === id ? { ...c, active: on ?? !c.active } : c
          );
          const firstActive = next.find((c) => c.active)?.id ?? null;
          return { credentials: next, activeId: firstActive };
        }),

      setActive: (id) => {
        if (id == null) {
          set({ activeId: null });
          return;
        }
        get().toggleActive(id, true);
      },

      dismissReentryBanner: () => set({ showReentryBanner: false }),
    }),
    {
      name: CREDENTIAL_STORE_NAME,
      version: CREDENTIAL_STORE_VERSION,
      migrate: (persisted, fromVersion) =>
        migrateCredentialPersist(persisted, fromVersion),
      merge: (persisted, current) => {
        // Scrub even when persist version is already 2 (S2 left apiKey in v2).
        const migrated = migrateCredentialPersist(
          persisted,
          CREDENTIAL_STORE_VERSION
        );
        return {
          ...current,
          ...migrated,
        };
      },
      partialize: (state) => ({
        credentials: state.credentials.map(pickSummaryFields),
        activeId: state.activeId,
        showReentryBanner: state.showReentryBanner,
      }),
      onRehydrateStorage: () => (state) => {
        void state?.hydrate();
      },
    }
  )
);
