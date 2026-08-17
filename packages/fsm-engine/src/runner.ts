import { resolveTransition, type EngineEdge, type EngineMask } from "./resolver";
import {
  defaultClock,
  resolveRetryOn,
  retryBackoffMs,
  runState,
  type Clock,
} from "./run-state";
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

export interface BeforeTransitionContext {
  state: EngineState;
  emission: Emission;
  inputPayload: unknown;
  attempts: number;
  resolved: { to: string; signal: string; payload: unknown };
}

export interface BeforeTransitionResult {
  ok: boolean;
  reason?: RetryReason;
  failureEmission?: Emission;
  /** llm_verify onFail === "error_signal" skips remaining retries. */
  skipRetry?: boolean;
}

async function pushEvent(
  events: EngineEvent[],
  event: EngineEvent,
  onEvent?: (event: EngineEvent) => void | Promise<void>
): Promise<void> {
  events.push(event);
  await onEvent?.(event);
}

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
  initialStateId?: string;
  initialPayload?: unknown;
  onEvent?: (event: EngineEvent) => void | Promise<void>;
  onBeforeTransition?: (
    ctx: BeforeTransitionContext
  ) => Promise<BeforeTransitionResult>;
}): Promise<RunFsmResult> {
  const byId = new Map(args.states.map((s) => [s.id, s]));
  const start = args.states.find((s) => s.type === "START");
  if (!start) {
    return { status: "failed", events: [], error: "Missing START" };
  }

  const events: EngineEvent[] = [];
  const clock = args.clock ?? defaultClock;
  let currentId = args.initialStateId ?? start.id;
  let payload: unknown = args.initialPayload ?? {};
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

    await pushEvent(
      events,
      {
        stateId: state.id,
        kind: "state.enter",
        message: formatStateEnter(state.id),
        payload: { stateId: state.id, attempt: 1 },
      },
      args.onEvent
    );

    if (state.type === "END") {
      return { status: "succeeded", events, finalStateId: state.id, aggregate };
    }

    if (state.type === "SYSTEM_FUNCTION" && state.mask) {
      activeMask = state.mask;
    }

    let emission: Emission;
    let resolved:
      | { ok: true; to: string; signal: string; payload: unknown }
      | { ok: false; message: string }
      | null = null;

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
      await pushEvent(
        events,
        {
          stateId: state.id,
          kind: "SPAWN",
          message: `spawned ${envelopes.length} children`,
          payload: envelopes,
        },
        args.onEvent
      );
      resolved = resolveTransition({
        fromStateId: state.id,
        emission,
        edges: args.edges,
        mask: activeMask,
      });
      if (resolved.ok && args.onBeforeTransition) {
        const gate = await args.onBeforeTransition({
          state,
          emission,
          inputPayload: payload,
          attempts: 1,
          resolved: {
            to: resolved.to,
            signal: resolved.signal,
            payload: resolved.payload,
          },
        });
        if (!gate.ok) {
          emission = gate.failureEmission ?? {
            signal: "::TRANSITION.VERIFY_FAIL",
            payload: { reason: gate.reason ?? "verify_fail" },
          };
          await pushEvent(
            events,
            {
              stateId: state.id,
              kind: "state.fail",
              message: formatStateFail(gate.reason ?? "verify_fail"),
              payload: { reason: gate.reason ?? "verify_fail", emission },
            },
            args.onEvent
          );
          resolved = resolveTransition({
            fromStateId: state.id,
            emission,
            edges: args.edges,
            mask: activeMask,
          });
        }
      }
    } else {
      const guardrails = state.guardrails ?? {
        timeoutMs: 30_000,
        retryMax: 0,
        retryBackoffMs: 0,
      };
      const maxAttempts = Math.max(1, guardrails.retryMax + 1);
      const retryOn = resolveRetryOn(guardrails);
      let verifyRetryCount = 0;

      stateLoop: while (true) {
        const result = await runState(
          {
            id: state.id,
            inputSchema: state.inputSchema,
            outputSchema: state.outputSchema,
            guardrails,
            onErrorSignal: state.onErrorSignal ?? "::SCRIPT.ERROR",
            execute: ({ payload: p, signal }) =>
              args.executeState({ state, payload: p, signal }),
          },
          payload,
          {
            clock,
            abortSignal: args.abortSignal,
            onRetry: async ({ attempt, reason }) => {
              await pushEvent(
                events,
                {
                  stateId: state.id,
                  kind: "state.retry",
                  message: formatStateRetry(attempt, reason),
                  payload: { attempt, reason, signal: formatStateRetry(attempt, reason) },
                },
                args.onEvent
              );
            },
          }
        );

        emission = result.emission;

        if (!result.ok) {
          await pushEvent(
            events,
            {
              stateId: state.id,
              kind: "state.fail",
              message: formatStateFail(result.reason),
              payload: { reason: result.reason, emission },
            },
            args.onEvent
          );
          resolved = resolveTransition({
            fromStateId: state.id,
            emission,
            edges: args.edges,
            mask: activeMask,
          });
          break stateLoop;
        }

        await pushEvent(
          events,
          {
            stateId: state.id,
            kind: "state.success",
            message: formatStateSuccess(),
            payload: emission,
          },
          args.onEvent
        );

        const tentative = resolveTransition({
          fromStateId: state.id,
          emission,
          edges: args.edges,
          mask: activeMask,
        });

        if (!tentative.ok) {
          resolved = tentative;
          break stateLoop;
        }

        if (args.onBeforeTransition) {
          const gate = await args.onBeforeTransition({
            state,
            emission,
            inputPayload: payload,
            attempts: result.attempts + verifyRetryCount,
            resolved: {
              to: tentative.to,
              signal: tentative.signal,
              payload: tentative.payload,
            },
          });

          if (!gate.ok) {
            const reason = gate.reason ?? "verify_fail";
            verifyRetryCount += 1;
            const attempt = result.attempts + verifyRetryCount;
            if (
              !gate.skipRetry &&
              attempt < maxAttempts &&
              retryOn.includes(reason)
            ) {
              await pushEvent(
                events,
                {
                  stateId: state.id,
                  kind: "state.retry",
                  message: formatStateRetry(attempt, reason),
                  payload: {
                    attempt,
                    reason,
                    signal: formatStateRetry(attempt, reason),
                  },
                },
                args.onEvent
              );
              await clock.sleep(
                retryBackoffMs(guardrails, attempt),
                args.abortSignal
              );
              continue stateLoop;
            }

            emission = gate.failureEmission ?? {
              signal: "::TRANSITION.VERIFY_FAIL",
              payload: { reason },
            };
            await pushEvent(
              events,
              {
                stateId: state.id,
                kind: "state.fail",
                message: formatStateFail("verify_fail"),
                payload: { reason: "verify_fail", emission },
              },
              args.onEvent
            );
            resolved = resolveTransition({
              fromStateId: state.id,
              emission,
              edges: args.edges,
              mask: activeMask,
            });
            break stateLoop;
          }
        }

        resolved = tentative;
        break stateLoop;
      }
    }

    if (!resolved || !resolved.ok) {
      return {
        status: "failed",
        events,
        finalStateId: state.id,
        aggregate,
        error: resolved && !resolved.ok ? resolved.message : "transition failed",
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
