"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CredentialEntry {
  id: string;
  label: string;
  provider: "openai" | "anthropic" | "openai-compatible";
  baseUrl: string;
  apiKey: string; // UI-only stub — real storage is AES-256-GCM server-side (§14)
  models: string[];
}

interface CredentialStore {
  credentials: CredentialEntry[];
  activeId: string | null;
  addCredential: (entry: Omit<CredentialEntry, "id" | "models">) => string;
  removeCredential: (id: string) => void;
  setModels: (id: string, models: string[]) => void;
  setActive: (id: string | null) => void;
}

export const useCredentialStore = create<CredentialStore>()(
  persist(
    (set) => ({
      credentials: [],
      activeId: null,

      addCredential: (entry) => {
        const id = `cred_${Date.now().toString(36)}`;
        set((state) => ({
          credentials: [...state.credentials, { ...entry, id, models: [] }],
          activeId: state.activeId ?? id,
        }));
        return id;
      },

      removeCredential: (id) =>
        set((state) => ({
          credentials: state.credentials.filter((c) => c.id !== id),
          activeId: state.activeId === id ? null : state.activeId,
        })),

      setModels: (id, models) =>
        set((state) => ({
          credentials: state.credentials.map((c) =>
            c.id === id ? { ...c, models } : c
          ),
        })),

      setActive: (id) => set({ activeId: id }),
    }),
    { name: "fsm-credential-store" }
  )
);
