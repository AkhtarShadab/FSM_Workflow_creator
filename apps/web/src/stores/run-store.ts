"use client";

import { create } from "zustand";

export interface RunEvent {
  id: string;
  stateId: string;
  kind: string;
  message: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  ts: number;
}

interface RunStore {
  live: boolean;
  runId: number | null;
  events: RunEvent[];
  start: (runId?: number | null) => void;
  stop: () => void;
  pushEvent: (event: Omit<RunEvent, "id" | "ts"> & { id?: string }) => void;
  reset: () => void;
}

let n = 0;

export const useRunStore = create<RunStore>()((set) => ({
  live: false,
  runId: null,
  events: [],

  start: (runId = null) => set({ live: true, runId: runId ?? null }),
  stop: () => set({ live: false }),

  pushEvent: (event) =>
    set((state) => ({
      events: [
        {
          ...event,
          id: event.id ?? `ev_${++n}`,
          ts: Date.now(),
        },
        ...state.events,
      ].slice(0, 200),
    })),

  reset: () => set({ events: [], live: false, runId: null }),
}));
