import { resolveTransition, type EngineEdge, type EngineMask } from "./resolver";
import { runState, type Clock } from "./run-state";
import { runSpawn, type ChildEnvelope, type SpawnPoolConfig } from "./spawn-pool";
import type { Emission } from "./signals";

export interface EngineState {
  id: string;
  type: string;
  label?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  onErrorSignal?: string;
  guardrails?: {
    timeoutMs: number;
    retryMax: number;
    retryBackoffMs: number;
  };
  mask?: EngineMask;
  spawn?: SpawnPoolConfig;
}

export interface EngineEvent {
  stateId: string;
  kind: string;
  message: string;
  payload?: unknown;
}

export interface RunFsmResult {
  status: "succeeded" | "failed";
  events: EngineEvent[];
  finalStateId?: string;
  aggregate?: ChildEnvelope[];
  error?: string;
}

export type StateExecutor = (args: {
  state: EngineState;
  payload: unknown;
  signal: AbortSignal;
}) => Promise<Emission>;

/**
 * Walk START → … → END using tool-chained transitions.
 * SCRIPT/HTTP/VALIDATE/AI use the injected executor; SPAWN uses runSpawn.
 */
export async function runFsm(args: {
  states: EngineState[];
  edges: EngineEdge[];
  executeState: StateExecutor;
  executeChild?: SpawnPoolConfig extends never ? never : (
    ctx: Parameters<Parameters<typeof runSpawn>[1]>[0]
  ) => Promise<unknown>;
  clock?: Clock;
  abortSignal?: AbortSignal;
  maxSteps?: number;
}): Promise<RunFsmResult> {
  const byId = new Map(args.states.map((s) => [s.id, s]));
  const start = args.states.find((s) => s.type === "START");
  if (!start) {
    return { status: "failed", events: [], error: "Missing START" };
  }

  const events: EngineEvent[] = [];
  let currentId = start.id;
  let payload: unknown = {};
  let activeMask: EngineMask | null = null;
  let aggregate: ChildEnvelope[] | undefined;
  const maxSteps = args.maxSteps ?? 100;

  for (let step = 0; step < maxSteps; step++) {
    const state = byId.get(currentId);
    if (!state) {
      return {
        status: "failed",
        events,
        error: `Unknown state ${currentId}`,
      };
    }

    events.push({
      stateId: state.id,
      kind: state.type,
      message: `enter ${state.label ?? state.id}`,
    });

    if (state.type === "END") {
      return { status: "succeeded", events, finalStateId: state.id, aggregate };
    }

    if (state.type === "SYSTEM_FUNCTION" && state.mask) {
      activeMask = state.mask;
    }

    let emission: Emission;

    if (state.type === "SPAWN" && state.spawn) {
      const childExec =
        args.executeChild ??
        (async () => ({ ok: true }));
      const envelopes = await runSpawn(state.spawn, childExec, {
        parentSignal: args.abortSignal,
      });
      aggregate = envelopes;
      emission = {
        signal: "::SPAWN.SUBAGENTS",
        payload: { envelopes },
      };
      events.push({
        stateId: state.id,
        kind: "SPAWN",
        message: `spawned ${envelopes.length} children`,
        payload: envelopes,
      });
    } else {
      const result = await runState(
        {
          id: state.id,
          inputSchema: state.inputSchema,
          outputSchema: state.outputSchema,
          guardrails: state.guardrails ?? {
            timeoutMs: 30_000,
            retryMax: 0,
            retryBackoffMs: 0,
          },
          onErrorSignal: state.onErrorSignal ?? "::SCRIPT.ERROR",
          execute: ({ payload: p, signal }) =>
            args.executeState({ state, payload: p, signal }),
        },
        payload,
        { clock: args.clock, abortSignal: args.abortSignal }
      );

      emission = result.emission;
      events.push({
        stateId: state.id,
        kind: state.type,
        message: result.ok
          ? `ok attempts=${result.attempts}`
          : `fail ${result.reason}`,
        payload: emission,
      });

      if (!result.ok) {
        // still try to follow error signal
      }
    }

    const resolved = resolveTransition({
      fromStateId: state.id,
      emission,
      edges: args.edges,
      mask: activeMask,
    });

    if (!resolved.ok) {
      return {
        status: "failed",
        events,
        finalStateId: state.id,
        aggregate,
        error: resolved.message,
      };
    }

    payload = resolved.payload;
    currentId = resolved.to;
  }

  return {
    status: "failed",
    events,
    error: "max steps exceeded",
    aggregate,
  };
}
