import type { EngineState, Emission } from "@fsm/engine";
import type { PhaseMap } from "@/lib/context/phase-map";
import type { StateNodeData } from "@/lib/fsm-types";

export type RunEventKind =
  | "state.start"
  | "state.token"
  | "state.output"
  | "state.retry"
  | "state.error"
  | "state.transition"
  | "human.awaiting"
  | "human.resolved"
  | "run.complete"
  | "run.failed";

export interface RunEventDraft {
  stateId: string;
  kind: RunEventKind | string;
  payload?: unknown;
  tokensIn?: number | null;
  tokensOut?: number | null;
  latencyMs?: number | null;
}

export interface PersistedRunEvent {
  id: number;
  runId: number;
  stateId: string;
  kind: string;
  payload: unknown;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
  ts: Date;
}

export interface EmitOptions {
  /** Default true. `state.token` deltas may be broadcast-only. */
  persist?: boolean;
}

export interface ExecutorContext {
  runId: number;
  state: EngineState;
  node?: { id: string; data: StateNodeData };
  payload: unknown;
  signal: AbortSignal;
  emit(ev: RunEventDraft, opts?: EmitOptions): Promise<void>;
  /**
   * Run-level State 0 phase map (011 T1). Built once per executeRun and
   * attached to every state; the supervisor prepends `formatPhaseMap` to the
   * first AI / EXTERNAL_AI system prompt only.
   */
  phaseMap?: PhaseMap;
}

export type Executor = (ctx: ExecutorContext) => Promise<Emission>;
