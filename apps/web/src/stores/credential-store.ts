"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DiscoveryProvider } from "@/lib/model-discovery";

export type DiscoveryStatus = "idle" | "discovering" | "ok" | "error";

export interface CredentialEntry {
  id: string;
  label: string;
  provider: DiscoveryProvider;
  baseUrl: string;
  apiKey: string; // UI-only stub — real storage is AES-256-GCM server-side (§14)
  models: string[];
  active: boolean;
  discoveryStatus: DiscoveryStatus;
  discoveryError?: string;
  discoveredAt?: number;
}

interface CredentialStore {
  credentials: CredentialEntry[];
  addCredential: (
    entry: Omit<
      CredentialEntry,
      | "id"
      | "models"
      | "active"
      | "discoveryStatus"
      | "discoveryError"
      | "discoveredAt"
    >
  ) => string;
  removeCredential: (id: string) => void;
  setModels: (
    id: string,
    models: string[],
    meta?: { status: DiscoveryStatus; error?: string; discoveredAt?: number }
  ) => void;
  setDiscoveryStatus: (
    id: string,
    status: DiscoveryStatus,
    error?: string
  ) => void;
  toggleActive: (id: string, on?: boolean) => void;
  /** @deprecated use toggleActive — kept for nav badge compat */
  setActive: (id: string | null) => void;
  activeId: string | null;
}

export const useCredentialStore = create<CredentialStore>()(
  persist(
    (set, get) => ({
      credentials: [],
      activeId: null,

      addCredential: (entry) => {
        const id = `cred_${Date.now().toString(36)}`;
        set((state) => ({
          credentials: [
            ...state.credentials,
            {
              ...entry,
              id,
              models: [],
              active: true,
              discoveryStatus: "idle",
            },
          ],
          activeId: state.activeId ?? id,
        }));
        return id;
      },

      removeCredential: (id) =>
        set((state) => ({
          credentials: state.credentials.filter((c) => c.id !== id),
          activeId: state.activeId === id ? null : state.activeId,
        })),

      setModels: (id, models, meta) =>
        set((state) => ({
          credentials: state.credentials.map((c) =>
            c.id === id
              ? {
                  ...c,
                  models,
                  discoveryStatus: meta?.status ?? "ok",
                  discoveryError: meta?.error,
                  discoveredAt: meta?.discoveredAt ?? Date.now(),
                }
              : c
          ),
        })),

      setDiscoveryStatus: (id, status, error) =>
        set((state) => ({
          credentials: state.credentials.map((c) =>
            c.id === id
              ? { ...c, discoveryStatus: status, discoveryError: error }
              : c
          ),
        })),

      toggleActive: (id, on) =>
        set((state) => {
          const next = state.credentials.map((c) =>
            c.id === id
              ? { ...c, active: on ?? !c.active }
              : c
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
    }),
    {
      name: "fsm-credential-store",
      version: 2,
      migrate: (persisted) => {
        const p = persisted as {
          credentials?: Array<Partial<CredentialEntry> & { id: string }>;
          activeId?: string | null;
        };
        return {
          activeId: p.activeId ?? null,
          credentials: (p.credentials ?? []).map((c) => ({
            id: c.id,
            label: c.label ?? "key",
            provider: (c.provider ?? "openai") as DiscoveryProvider,
            baseUrl: c.baseUrl ?? "",
            apiKey: c.apiKey ?? "",
            models: c.models ?? [],
            active: c.active ?? c.id === p.activeId,
            discoveryStatus: (c.discoveryStatus ??
              (c.models && c.models.length ? "ok" : "idle")) as DiscoveryStatus,
            discoveryError: c.discoveryError,
            discoveredAt: c.discoveredAt,
          })),
        };
      },
    }
  )
);
