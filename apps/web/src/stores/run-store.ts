"use client";

import { create } from "zustand";

export interface RunEvent {
  id: string;
  stateId: string;
  kind: "SCRIPT" | "AI" | "SYSTEM" | "SPAWN";
  message: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  ts: number;
}

interface RunStore {
  live: boolean;
  events: RunEvent[];
  start: () => void;
  stop: () => void;
  pushEvent: (event: Omit<RunEvent, "id" | "ts">) => void;
  reset: () => void;
}

let n = 0;

export const useRunStore = create<RunStore>()((set) => ({
  live: false,
  events: [],

  start: () => set({ live: true }),
  stop: () => set({ live: false }),

  pushEvent: (event) =>
    set((state) => ({
      events: [
        { ...event, id: `ev_${++n}`, ts: Date.now() },
        ...state.events,
      ].slice(0, 50),
    })),

  reset: () => set({ events: [], live: false }),
}));
