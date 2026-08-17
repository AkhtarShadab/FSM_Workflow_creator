"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CanvasData } from "@/lib/fsm-types";
import {
  emptyRegistry,
  registerCustomState,
  registerSignal,
  registerSkill,
  removeCustomState,
  removeSignal,
  removeSkill,
  type CustomStateType,
  type ProjectRegistry,
} from "@/lib/registry";

interface RegistryStore {
  registry: ProjectRegistry;
  setRegistry: (registry: ProjectRegistry) => void;
  addSignal: (signal: string, description: string) => void;
  addSkill: (skillId: string) => void;
  addCustomState: (state: CustomStateType) => void;
  deleteSignal: (signal: string, canvas?: CanvasData) => void;
  deleteSkill: (skillId: string) => void;
  deleteCustomState: (stateId: string) => void;
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
      deleteSignal: (signal, canvas) =>
        set((s) => ({
          registry: removeSignal(s.registry, signal, canvas),
        })),
      deleteSkill: (skillId) =>
        set((s) => ({ registry: removeSkill(s.registry, skillId) })),
      deleteCustomState: (stateId) =>
        set((s) => ({
          registry: removeCustomState(s.registry, stateId),
        })),
    }),
    { name: "fsm-project-registry" }
  )
);
