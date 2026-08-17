import { resolveTransition, type EngineEdge, type EngineMask } from "./resolver";
import { runState, type Clock } from "./run-state";
import { runSpawn, type ChildEnvelope, type SpawnPoolConfig } from "./spawn-pool";
import type { Emission } from "./signals";
import type { RetryReason } from "./signals";
import {
  formatStateEnter,
  formatStateFail,
  formatStateRetry,
  formatStateSuccess,
} from "./signals";

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
    retryOn?: RetryReason[];
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
  /** Per self-loop edge key → iteration count (§10.4) */
  const selfLoopCounts = new Map<string, number>();

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
      kind: "state.enter",
      message: formatStateEnter(state.id),
      payload: { stateId: state.id, attempt: 1 },
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
        {
          clock: args.clock,
          abortSignal: args.abortSignal,
          onRetry: ({ attempt, reason }) => {
            events.push({
              stateId: state.id,
              kind: "state.retry",
              message: formatStateRetry(attempt, reason),
              payload: { attempt, reason },
            });
          },
        }
      );

      emission = result.emission;

      if (result.ok) {
        events.push({
          stateId: state.id,
          kind: "state.success",
          message: formatStateSuccess(),
          payload: emission,
        });
      } else {
        events.push({
          stateId: state.id,
          kind: "state.fail",
          message: formatStateFail(result.reason),
          payload: { reason: result.reason, emission },
        });
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

    const matchedEdge = args.edges.find(
      (e) =>
        e.from === state.id &&
        e.on === resolved.signal &&
        e.to === resolved.to
    );
    if (
      matchedEdge &&
      (matchedEdge.kind === "self-loop" || matchedEdge.from === matchedEdge.to)
    ) {
      const key = `${matchedEdge.from}|${matchedEdge.on}|${matchedEdge.to}`;
      const next = (selfLoopCounts.get(key) ?? 0) + 1;
      selfLoopCounts.set(key, next);
      const cap = matchedEdge.maxIterations ?? 3;
      if (next > cap) {
        return {
          status: "failed",
          events,
          finalStateId: state.id,
          aggregate,
          error: `Self-loop exceeded maxIterations=${cap} on ${key}`,
        };
      }
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
