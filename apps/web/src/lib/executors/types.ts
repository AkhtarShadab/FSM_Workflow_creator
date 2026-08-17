import type { EngineState, Emission } from "@fsm/engine";
import type { StateNodeData } from "@/lib/fsm-types";
import type { ChatMessage } from "@/lib/run-context";
import type { ToolGrant } from "@/lib/tool-grants";

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
  | "run.failed"
  | "run.cursor"
  | "run.resume_without_cursor";

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

export interface ToolGrantContext {
  allowedTools: string[];
  mintGrant: (toolName: string) => ToolGrant;
  requireGrant: (toolName: string, grant?: ToolGrant) => void;
}

export interface ExecutorContext {
  runId: number;
  state: EngineState;
  node?: { id: string; data: StateNodeData };
  history?: ChatMessage[];
  payload: unknown;
  signal: AbortSignal;
  emit(ev: RunEventDraft, opts?: EmitOptions): Promise<void>;
  tools?: ToolGrantContext;
}

export type Executor = (ctx: ExecutorContext) => Promise<Emission>;
