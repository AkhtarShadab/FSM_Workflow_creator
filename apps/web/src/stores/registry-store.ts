"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  emptyRegistry,
  registerCustomState,
  registerSignal,
  registerSkill,
  registerSysFuncTemplate,
  removeSignal,
  removeSkill,
  removeSysFuncTemplate,
  type CustomStateType,
  type CustomSysFuncTemplate,
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
  saveSysFuncTemplate: (template: CustomSysFuncTemplate) => void;
  deleteSysFuncTemplate: (id: string) => void;
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
      saveSysFuncTemplate: (template) =>
        set((s) => ({ registry: registerSysFuncTemplate(s.registry, template) })),
      deleteSysFuncTemplate: (id) =>
        set((s) => ({ registry: removeSysFuncTemplate(s.registry, id) })),
    }),
    { name: "fsm-project-registry" }
  )
);
