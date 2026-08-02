"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  emptyRegistry,
  registerCustomState,
  registerSignal,
  registerSkill,
  removeSignal,
  removeSkill,
  type CustomStateType,
  type ProjectRegistry,
} from "@/lib/registry";

interface RegistryStore {
  registry: ProjectRegistry;
  setRegistry: (registry: ProjectRegistry) => void;
  addSignal: (signal: string, description?: string) => void;
  addSkill: (skillId: string) => void;
  addCustomState: (state: CustomStateType) => void;
  deleteSignal: (signal: string) => void;
  deleteSkill: (skillId: string) => void;
}

export const useRegistryStore = create<RegistryStore>()(
  persist(
    (set) => ({
      registry: emptyRegistry(),
      setRegistry: (registry) => set({ registry }),
      addSignal: (signal, description) =>
        set((s) => ({
          registry: registerSignal(s.registry, signal, description),
        })),
      addSkill: (skillId) =>
        set((s) => ({ registry: registerSkill(s.registry, skillId) })),
      addCustomState: (state) =>
        set((s) => ({
          registry: registerCustomState(s.registry, state),
        })),
      deleteSignal: (signal) =>
        set((s) => ({ registry: removeSignal(s.registry, signal) })),
      deleteSkill: (skillId) =>
        set((s) => ({ registry: removeSkill(s.registry, skillId) })),
    }),
    { name: "fsm-project-registry" }
  )
);
