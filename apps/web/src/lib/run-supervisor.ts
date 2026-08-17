import { db } from "@/db";
import { fsmDefinitions, runEvents, runs } from "@/db/schema";
import { canvasToDsl } from "@/lib/canvas-to-dsl";
import type { CanvasData, StateNodeData } from "@/lib/fsm-types";
import {
  defaultHumanBridge,
  type HumanBridge,
  type HumanResolution,
} from "@/lib/executors/human-bridge";
import { getExecutor } from "@/lib/executors/registry";
import type {
  Executor,
  ExecutorContext,
  PersistedRunEvent,
  RunEventDraft,
} from "@/lib/executors/types";
import { sanitizeEventPayload } from "@/lib/event-sanitize";
import { canvasToEngine } from "@/lib/run-engine";
import {
  defaultSuccessSignal,
  dslToEngine,
  inheritToolsForState,
  nodesFromDsl,
  outgoingSignalsForState,
  parsePayloadRef,
  payloadToRef,
  readRetainContext,
  readSuccessCondition,
  readToolAccess,
} from "@/lib/run-contract-helpers";
import { dropStateMemory, type RunContext } from "@/lib/run-context";
import {
  findLatestCursor,
  resumeFromEvents,
  RUN_CURSOR_KIND,
  serializeRunCursor,
} from "@/lib/run-cursor";
import {
  assertToolInAllowlist,
  mintToolGrant,
  resolveAllowedTools,
  TOOL_DENIED_SIGNAL,
  verifyToolGrant,
} from "@/lib/tool-grants";
import { evaluateSuccessCondition } from "@/lib/verify-success";
import {
  parseSignal,
  runFsm,
  type BeforeTransitionContext,
  type Emission,
  type EngineEvent,
  type EngineState,
  type StateExecutor,
} from "@fsm/engine";
import { and, asc, desc, eq, gt } from "drizzle-orm";

export type RunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "awaiting_human";

export interface RunStore {
  insertEvent(runId: number, draft: RunEventDraft): Promise<PersistedRunEvent>;
  listEventsAfter(runId: number, afterId: number): Promise<PersistedRunEvent[]>;
  listEvents?(runId: number): Promise<PersistedRunEvent[]>;
  updateRun(
    runId: number,
    patch: { status: RunStatus; endedAt?: Date }
  ): Promise<void>;
  markOrphanedRunning(): Promise<number>;
  getRunStatus?(runId: number): Promise<string | null>;
}

export interface EventBus {
  subscribe(runId: number, handler: (ev: PersistedRunEvent) => void): () => void;
  publish(ev: PersistedRunEvent): void;
}

type Handler = (ev: PersistedRunEvent) => void;

export function createEventBus(): EventBus {
  const byRun = new Map<number, Set<Handler>>();
  return {
    subscribe(runId, handler) {
      let set = byRun.get(runId);
      if (!set) {
        set = new Set();
        byRun.set(runId, set);
      }
      set.add(handler);
      return () => {
        set!.delete(handler);
        if (set!.size === 0) byRun.delete(runId);
      };
    },
    publish(ev) {
      const set = byRun.get(ev.runId);
      if (!set) return;
      for (const h of set) h(ev);
    },
  };
}

export function createMemoryRunStore(): RunStore & {
  events: PersistedRunEvent[];
  statuses: Map<number, RunStatus>;
} {
  let nextId = 1;
  const events: PersistedRunEvent[] = [];
  const statuses = new Map<number, RunStatus>();
  return {
    events,
    statuses,
    async insertEvent(runId, draft) {
      const row: PersistedRunEvent = {
        id: nextId++,
        runId,
        stateId: draft.stateId,
        kind: draft.kind,
        payload: sanitizeEventPayload(draft.payload) ?? null,
        tokensIn: draft.tokensIn ?? null,
        tokensOut: draft.tokensOut ?? null,
        latencyMs: draft.latencyMs ?? null,
        ts: new Date(),
      };
      events.push(row);
      return row;
    },
    async listEventsAfter(runId, afterId) {
      return events.filter((e) => e.runId === runId && e.id > afterId);
    },
    async listEvents(runId) {
      return events.filter((e) => e.runId === runId);
    },
    async updateRun(runId, patch) {
      statuses.set(runId, patch.status);
    },
    async markOrphanedRunning() {
      let n = 0;
      for (const [id, status] of statuses) {
        if (status === "running") {
          statuses.set(id, "interrupted");
          n++;
        }
      }
      return n;
    },
    async getRunStatus(runId) {
      return statuses.get(runId) ?? null;
    },
  };
}

function hydrateRow(row: typeof runEvents.$inferSelect): PersistedRunEvent {
  let payload: unknown = null;
  if (row.payloadJson) {
    try {
      payload = JSON.parse(row.payloadJson) as unknown;
    } catch {
      payload = row.payloadJson;
    }
  }
  return {
    id: row.id,
    runId: row.runId,
    stateId: row.stateId,
    kind: row.kind,
    payload,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    latencyMs: row.latencyMs,
    ts: row.ts,
  };
}

export const drizzleRunStore: RunStore = {
  async insertEvent(runId, draft) {
    const [row] = await db
      .insert(runEvents)
      .values({
        runId,
        stateId: draft.stateId,
        kind: draft.kind,
        payloadJson:
          draft.payload === undefined
            ? null
            : JSON.stringify(sanitizeEventPayload(draft.payload)),
        tokensIn: draft.tokensIn ?? null,
        tokensOut: draft.tokensOut ?? null,
        latencyMs: draft.latencyMs ?? null,
      })
      .returning();
    if (!row) throw new Error("failed to persist run event");
    return hydrateRow(row);
  },
  async listEventsAfter(runId, afterId) {
    const rows = await db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.id, afterId)))
      .orderBy(asc(runEvents.id));
    return rows.map(hydrateRow);
  },
  async listEvents(runId) {
    const rows = await db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.id));
    return rows.map(hydrateRow);
  },
  async updateRun(runId, patch) {
    await db
      .update(runs)
      .set({
        status: patch.status,
        endedAt:
          patch.endedAt ??
          (isOpenRunStatus(patch.status) ? null : new Date()),
      })
      .where(eq(runs.id, runId));
  },
  async markOrphanedRunning() {
    const rows = await db
      .update(runs)
      .set({ status: "interrupted", endedAt: new Date() })
      .where(eq(runs.status, "running"))
      .returning({ id: runs.id });
    return rows.length;
  },
  async getRunStatus(runId) {
    const [row] = await db
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    return row?.status ?? null;
  },
};

export interface ActiveRun {
  controller: AbortController;
  done: Promise<void>;
}

function isOpenRunStatus(status: RunStatus): boolean {
  return status === "running" || status === "awaiting_human" || status === "pending";
}

async function defaultLoadRunDefinition(
  runId: number
): Promise<{ json: string; canvas?: CanvasData } | null> {
  const [runRow] = await db
    .select({ fsmId: runs.fsmId })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!runRow) return null;
  const [fsmRow] = await db
    .select({ json: fsmDefinitions.json })
    .from(fsmDefinitions)
    .where(eq(fsmDefinitions.id, runRow.fsmId))
    .limit(1);
  if (!fsmRow) return null;
  return { json: fsmRow.json };
}

export interface SupervisorDeps {
  store?: RunStore;
  bus?: EventBus;
  getExecutor?: (type: string) => Executor;
  humanBridge?: HumanBridge;
  loadRunDefinition?: (
    runId: number
  ) => Promise<{ json: string; canvas?: CanvasData } | null>;
}

export interface ExecuteRunOptions {
  canvas?: CanvasData;
  states?: EngineState[];
  edges?: ReturnType<typeof canvasToEngine>["edges"];
  nodesById?: Map<string, { id: string; data: StateNodeData }>;
  executeState?: StateExecutor;
  initialStateId?: string;
  initialPayload?: unknown;
  resumeWithoutCursor?: boolean;
}

const defaultBus = createEventBus();

function createEmptyRunContext(runId: number): RunContext {
  return {
    vars: {},
    payload: {},
    history: [],
    toolLogs: [],
    ledger: {
      runId,
      totals: { tokensIn: 0, tokensOut: 0 },
      byState: {},
    },
  };
}

function emissionPayload(emission: Emission): Record<string, unknown> {
  const parsed = parseSignal(emission);
  return parsed.payload;
}

function emissionOutput(emission: Emission): unknown {
  const p = emissionPayload(emission);
  return "payload" in p ? p.payload ?? p : p;
}

export function createRunSupervisor(deps: SupervisorDeps = {}) {
  const store = deps.store ?? drizzleRunStore;
  const bus = deps.bus ?? defaultBus;
  const resolveExecutor = deps.getExecutor ?? getExecutor;
  const humanBridge = deps.humanBridge ?? defaultHumanBridge;
  const loadRunDefinition =
    deps.loadRunDefinition ?? defaultLoadRunDefinition;
  const registry = new Map<number, ActiveRun>();

  function ensureController(runId: number): AbortController {
    const existing = registry.get(runId);
    if (existing) return existing.controller;
    const controller = new AbortController();
    registry.set(runId, { controller, done: Promise.resolve() });
    return controller;
  }

  async function emit(
    runId: number,
    draft: RunEventDraft,
    opts?: { persist?: boolean }
  ): Promise<PersistedRunEvent> {
    const persist = opts?.persist !== false;
    let event: PersistedRunEvent;
    if (persist) {
      event = await store.insertEvent(runId, draft);
    } else {
      event = {
        id: -1,
        runId,
        stateId: draft.stateId,
        kind: draft.kind,
        payload: sanitizeEventPayload(draft.payload) ?? null,
        tokensIn: draft.tokensIn ?? null,
        tokensOut: draft.tokensOut ?? null,
        latencyMs: draft.latencyMs ?? null,
        ts: new Date(),
      };
    }
    bus.publish(event);
    return event;
  }

  async function listAllEvents(runId: number): Promise<PersistedRunEvent[]> {
    if (store.listEvents) return store.listEvents(runId);
    return store.listEventsAfter(runId, -1);
  }

  function buildToolContext(
    runId: number,
    state: EngineState,
    node: { id: string; data: StateNodeData } | undefined
  ) {
    const access = readToolAccess(node?.data);
    const inherit = inheritToolsForState(node?.data, state.type);
    const allowedTools = resolveAllowedTools(access, inherit);
    const timeoutMs = state.guardrails?.timeoutMs ?? 30_000;
    const exp = Date.now() + timeoutMs + 5_000;

    return {
      allowedTools,
      mintGrant: (toolName: string) =>
        mintToolGrant({ runId, stateId: state.id, toolName, exp }),
      requireGrant: (toolName: string, grant?: ReturnType<typeof mintToolGrant>) => {
        assertToolInAllowlist(allowedTools, toolName);
        const g = grant ?? mintToolGrant({ runId, stateId: state.id, toolName, exp });
        if (!verifyToolGrant(g)) {
          assertToolInAllowlist([], toolName);
        }
      },
    };
  }

  function wrapExecute(
    runId: number,
    nodesById: Map<string, { id: string; data: StateNodeData }>,
    runCtx: RunContext,
    custom?: StateExecutor
  ): StateExecutor {
    return async ({ state, payload, signal }) => {
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      await emit(runId, {
        stateId: state.id,
        kind: "state.start",
        payload: { type: state.type },
      });
      const started = Date.now();
      const node = nodesById.get(state.id);
      const tools = buildToolContext(runId, state, node);
      const ctx: ExecutorContext = {
        runId,
        state,
        node,
        payload: payload,
        history: runCtx.history,
        signal,
        tools,
        emit: (draft, opts) => emit(runId, draft, opts).then(() => undefined),
      };
      try {
        const emission: Emission = custom
          ? await custom({ state, payload, signal })
          : await resolveExecutor(state.type)(ctx);
        const latencyMs = Date.now() - started;
        const parsed = parseSignal(emission);
        const tokensIn =
          typeof parsed.payload.tokensIn === "number"
            ? parsed.payload.tokensIn
            : null;
        const tokensOut =
          typeof parsed.payload.tokensOut === "number"
            ? parsed.payload.tokensOut
            : null;

        await emit(runId, {
          stateId: state.id,
          kind: "state.output",
          payload: { signal: parsed.signal, payload: parsed.payload },
          latencyMs,
          tokensIn,
          tokensOut,
        });

        return emission;
      } catch (err) {
        const aborted =
          signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError");
        await emit(runId, {
          stateId: state.id,
          kind: "state.error",
          payload: {
            code: aborted ? "CANCELLED" : "EXECUTE",
            message: err instanceof Error ? err.message : String(err),
          },
        });
        throw err;
      }
    };
  }

  async function onBeforeTransition(
    runId: number,
    runCtx: RunContext,
    nodesById: Map<string, { id: string; data: StateNodeData }>,
    edges: ReturnType<typeof canvasToEngine>["edges"],
    ctx: BeforeTransitionContext
  ) {
    const node = nodesById.get(ctx.state.id);
    const parsed = parseSignal(ctx.emission);
    const condition = readSuccessCondition(node?.data);
    const verify = await evaluateSuccessCondition(condition, {
      signal: parsed.signal,
      payload: emissionOutput(ctx.emission),
      stateId: ctx.state.id,
      successSignal: defaultSuccessSignal(ctx.state.type),
      outgoingSignals: outgoingSignalsForState(ctx.state.id, edges),
    });

    if (parsed.signal === TOOL_DENIED_SIGNAL) {
      return {
        ok: false as const,
        reason: "tool_denied" as const,
        failureEmission: ctx.emission,
      };
    }

    if (!verify.pass) {
      const skipRetry =
        condition.kind === "llm_verify" && condition.onFail === "error_signal";
      return {
        ok: false as const,
        reason: "verify_fail" as const,
        failureEmission: {
          signal: "::TRANSITION.VERIFY_FAIL",
          payload: { reason: verify.reason ?? "verify_fail" },
        },
        skipRetry,
      };
    }

    const out = emissionOutput(ctx.emission);
    runCtx.vars[ctx.state.id] = out;
    runCtx.payload = out;
    const text =
      out && typeof out === "object" && "text" in (out as object)
        ? String((out as { text: unknown }).text ?? "")
        : "";
    if (text) {
      runCtx.history.push({ role: "assistant", content: text });
    }

    const cursorEvent = serializeRunCursor(ctx.state.id, {
      lastCompletedStateId: ctx.state.id,
      lastSignal: parsed.signal,
      nextStateId: ctx.resolved.to,
      attempt: ctx.attempts,
      payloadRef: payloadToRef(out),
    });
    await emit(runId, {
      stateId: ctx.state.id,
      kind: RUN_CURSOR_KIND,
      payload: cursorEvent.payload,
    });

    if (ctx.state.type !== "SYSTEM_FUNCTION") {
      const retain = readRetainContext(node?.data);
      const next = dropStateMemory(runCtx, {
        stateId: ctx.state.id,
        retainContext: retain,
      });
      runCtx.history = next.history;
      runCtx.toolLogs = next.toolLogs;
      runCtx.vars = next.vars;
      runCtx.payload = next.payload;
    }

    await emit(runId, {
      stateId: ctx.state.id,
      kind: "state.transition",
      payload: { signal: ctx.resolved.signal, toHint: ctx.resolved.to },
    });

    return { ok: true as const };
  }

  async function persistEngineEvent(
    runId: number,
    event: EngineEvent
  ): Promise<void> {
    if (event.kind === "state.enter") return;
    if (event.kind === "state.success") return;
    const kind =
      event.kind === "state.retry"
        ? "state.retry"
        : event.kind === "state.fail"
          ? "state.error"
          : event.kind;
    const extra =
      event.payload && typeof event.payload === "object"
        ? (event.payload as Record<string, unknown>)
        : {};
    await emit(runId, {
      stateId: event.stateId,
      kind,
      payload: { ...extra, message: event.message },
    });
  }

  async function executeRun(
    runId: number,
    canvasOrOpts: CanvasData | ExecuteRunOptions
  ): Promise<void> {
    const opts: ExecuteRunOptions =
      "nodes" in canvasOrOpts && "edges" in canvasOrOpts && !("canvas" in canvasOrOpts)
        ? { canvas: canvasOrOpts as CanvasData }
        : (canvasOrOpts as ExecuteRunOptions);

    const canvas = opts.canvas;
    const { states, edges } = opts.states && opts.edges
      ? { states: opts.states, edges: opts.edges }
      : canvas
        ? canvasToEngine(canvas)
        : { states: [], edges: [] };

    const nodesById =
      opts.nodesById ??
      new Map(
        (canvas?.nodes ?? []).map((n) => [
          n.id,
          { id: n.id, data: n.data },
        ])
      );

    const controller = ensureController(runId);
    const runCtx = createEmptyRunContext(runId);

    if (opts.initialPayload !== undefined) {
      runCtx.payload = opts.initialPayload;
    }

    if (opts.resumeWithoutCursor) {
      await emit(runId, {
        stateId: "",
        kind: "run.resume_without_cursor",
        payload: { warning: "resume_without_cursor" },
      });
    }

    const done = (async () => {
      try {
        const result = await runFsm({
          states,
          edges,
          executeState: wrapExecute(
            runId,
            nodesById,
            runCtx,
            opts.executeState
          ),
          executeChild: async () => ({ stub: true }),
          abortSignal: controller.signal,
          initialStateId: opts.initialStateId,
          initialPayload: opts.initialPayload,
          onEvent: (ev) => persistEngineEvent(runId, ev),
          onBeforeTransition: (ctx) =>
            onBeforeTransition(runId, runCtx, nodesById, edges, ctx),
        });

        if (controller.signal.aborted) {
          await store.updateRun(runId, {
            status: "cancelled",
            endedAt: new Date(),
          });
          await emit(runId, {
            stateId: result.finalStateId ?? "",
            kind: "run.failed",
            payload: { code: "CANCELLED" },
          });
          return;
        }

        if (result.status === "succeeded") {
          await store.updateRun(runId, {
            status: "succeeded",
            endedAt: new Date(),
          });
          await emit(runId, {
            stateId: result.finalStateId ?? "",
            kind: "run.complete",
            payload: {},
          });
        } else {
          const denied = result.events.some(
            (e) =>
              e.kind === "state.fail" &&
              e.payload &&
              typeof e.payload === "object" &&
              "emission" in (e.payload as object) &&
              parseSignal(
                (e.payload as { emission: Emission }).emission
              ).signal === TOOL_DENIED_SIGNAL
          );
          await store.updateRun(runId, {
            status: "failed",
            endedAt: new Date(),
          });
          await emit(runId, {
            stateId: result.finalStateId ?? "",
            kind: "run.failed",
            payload: {
              error: result.error ?? "failed",
              toolDenied: denied,
            },
          });
        }
      } catch (err) {
        if (controller.signal.aborted) {
          await store.updateRun(runId, {
            status: "cancelled",
            endedAt: new Date(),
          });
          await emit(runId, {
            stateId: "",
            kind: "run.failed",
            payload: { code: "CANCELLED" },
          });
          return;
        }
        await store.updateRun(runId, {
          status: "failed",
          endedAt: new Date(),
        });
        await emit(runId, {
          stateId: "",
          kind: "run.failed",
          payload: {
            error: err instanceof Error ? err.message : String(err),
          },
        });
      } finally {
        registry.delete(runId);
      }
    })();

    registry.set(runId, { controller, done });
    await store.updateRun(runId, { status: "running" });
    await done;
  }

  function beginRun(
    runId: number,
    canvasOrOpts: CanvasData | ExecuteRunOptions
  ): { runId: number; done: Promise<void> } {
    const controller = ensureController(runId);
    const done = executeRun(runId, canvasOrOpts);
    registry.set(runId, { controller, done });
    return { runId, done };
  }

  /**
   * Persist FSM + run row, start execution without awaiting it.
   * POST /runs uses this so it can return 202 immediately.
   */
  async function start(
    projectId: number,
    canvas: CanvasData
  ): Promise<{ runId: number }> {
    await reconcileOrphanedRuns(store);
    const dsl = JSON.stringify(canvasToDsl(canvas));
    const [last] = await db
      .select({ version: fsmDefinitions.version })
      .from(fsmDefinitions)
      .where(eq(fsmDefinitions.projectId, projectId))
      .orderBy(desc(fsmDefinitions.version))
      .limit(1);
    const version = (last?.version ?? 0) + 1;
    const [fsm] = await db
      .insert(fsmDefinitions)
      .values({ projectId, version, json: dsl })
      .returning();
    const [run] = await db
      .insert(runs)
      .values({ fsmId: fsm.id, status: "running" })
      .returning();

    const controller = ensureController(run.id);
    const done = executeRun(run.id, canvas).catch(() => undefined);
    registry.set(run.id, { controller, done });
    return { runId: run.id };
  }

  async function resume(
    runId: number
  ): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
    if (registry.has(runId)) {
      return { ok: false, error: "ALREADY_RUNNING", status: 409 };
    }
    const status = (await store.getRunStatus?.(runId)) ?? null;
    if (status === "running") {
      return { ok: false, error: "ALREADY_RUNNING", status: 409 };
    }
    if (status !== "interrupted") {
      return { ok: false, error: "NOT_RESUMABLE", status: 400 };
    }

    const def = await loadRunDefinition(runId);
    if (!def) {
      return { ok: false, error: "RUN_NOT_FOUND", status: 404 };
    }

    const events = await listAllEvents(runId);
    const resumeInfo = resumeFromEvents(
      events.map((e) => ({
        kind: e.kind,
        stateId: e.stateId,
        payload: e.payload,
      }))
    );

    const { states, edges } = def.canvas
      ? canvasToEngine(def.canvas)
      : dslToEngine(def.json);
    const nodesById = def.canvas
      ? new Map(
          def.canvas.nodes.map((n) => [n.id, { id: n.id, data: n.data }])
        )
      : nodesFromDsl(def.json);
    const byId = new Map(states.map((s) => [s.id, s]));
    if (resumeInfo.from !== "START" && !byId.has(resumeInfo.from)) {
      return { ok: false, error: "CURSOR_STATE_MISSING", status: 400 };
    }

    const initialPayload = resumeInfo.cursor
      ? parsePayloadRef(resumeInfo.cursor.payloadRef)
      : {};

    beginRun(runId, {
      canvas: def.canvas,
      states,
      edges,
      nodesById,
      initialStateId:
        resumeInfo.from === "START" ? undefined : resumeInfo.from,
      initialPayload,
      resumeWithoutCursor: resumeInfo.warning === "resume_without_cursor",
    });

    return { ok: true };
  }

  function cancel(runId: number): boolean {
    const active = registry.get(runId);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  async function resumeHuman(
    runId: number,
    taskId: number,
    resolution: HumanResolution
  ): Promise<boolean> {
    const woke = humanBridge.resolve(runId, taskId, resolution);
    if (woke) {
      await store.updateRun(runId, { status: "running" });
    }
    return woke;
  }

  function subscribe(
    runId: number,
    handler: (ev: PersistedRunEvent) => void
  ): () => void {
    return bus.subscribe(runId, handler);
  }

  async function listEventsAfter(runId: number, afterId: number) {
    return store.listEventsAfter(runId, afterId);
  }

  function getActive(runId: number) {
    return registry.get(runId);
  }

  function getLatestCursor(runId: number) {
    return listAllEvents(runId).then((events) =>
      findLatestCursor(
        events.map((e) => ({
          kind: e.kind,
          stateId: e.stateId,
          payload: e.payload,
        }))
      )
    );
  }

  return {
    start,
    beginRun,
    executeRun,
    resume,
    cancel,
    resumeHuman,
    subscribe,
    listEventsAfter,
    getActive,
    getLatestCursor,
    store,
    bus,
    humanBridge,
    emit,
  };
}

export async function reconcileOrphanedRuns(
  store: RunStore = drizzleRunStore
): Promise<number> {
  return store.markOrphanedRunning();
}

/** Process-wide supervisor used by API routes. */
export const runSupervisor = createRunSupervisor();

export function subscribeToRun(
  runId: number,
  handler: (ev: PersistedRunEvent) => void
): () => void {
  return runSupervisor.subscribe(runId, handler);
}

export async function listRunEventsAfter(runId: number, afterId: number) {
  return runSupervisor.listEventsAfter(runId, afterId);
}
