/**
 * R5 — Per-state memory drop (FeatureShipping 014).
 * SYS_FUNC dehydrate is handled by the supervisor caller; this helper only
 * clears conversational/tool memory after a successful state.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StateUsage {
  tokensIn: number;
  tokensOut: number;
}

export interface RunLedger {
  runId: number;
  totals: StateUsage;
  byState: Record<string, StateUsage>;
}

export interface PhaseMapCluster {
  id: string;
  label: string;
  summary: string;
  stateCount: number;
}

export interface PhaseMap {
  clusters: PhaseMapCluster[];
  overflow?: string;
}

export interface RunContext {
  vars: Record<string, unknown>;
  payload: unknown;
  history: ChatMessage[];
  toolLogs: string[];
  phaseMap?: PhaseMap;
  ledger: RunLedger;
}

export interface DropStateMemoryOptions {
  stateId: string;
  retainContext?: boolean;
}

export function dropStateMemory(
  ctx: RunContext,
  options: DropStateMemoryOptions
): RunContext {
  const { stateId, retainContext = false } = options;
  const next: RunContext = {
    ...ctx,
    vars: { ...ctx.vars },
    history: retainContext ? [...ctx.history] : [],
    toolLogs: retainContext ? [...ctx.toolLogs] : [],
  };
  // payload and vars[stateId] are intentionally preserved; phaseMap + ledger kept.
  if (stateId in ctx.vars) {
    next.vars[stateId] = ctx.vars[stateId];
  }
  return next;
}
