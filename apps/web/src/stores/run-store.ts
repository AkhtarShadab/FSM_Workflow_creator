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
  /** Replace the log with a run's events in chronological order. */
  replaceEvents: (events: Array<Omit<RunEvent, "id" | "ts">>) => void;
  reset: () => void;
}

let n = 0;

export const useRunStore = create<RunStore>()((set) => ({
  live: false,
  events: [],

  start: () => set({ live: true }),
  stop: () => set({ live: false }),

  // Appends (chronological, oldest first) so a replayed run reads top-down.
  pushEvent: (event) =>
    set((state) => ({
      events: [
        ...state.events,
        { ...event, id: `ev_${++n}`, ts: Date.now() },
      ].slice(-200),
    })),

  replaceEvents: (list) =>
    set({
      events: list.slice(0, 200).map((event) => ({
        ...event,
        id: `ev_${++n}`,
        ts: Date.now(),
      })),
    }),

  reset: () => set({ events: [], live: false }),
}));
