import type { EngineState, Emission } from "@fsm/engine";
import type { StateNodeData } from "@/lib/fsm-types";

export type RunEventKind =
  | "state.start"
  | "state.token"
  | "state.log"
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
}

export type Executor = (ctx: ExecutorContext) => Promise<Emission>;
