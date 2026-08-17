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
  parseSignal,
  runFsm,
  type Emission,
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

export interface SupervisorDeps {
  store?: RunStore;
  bus?: EventBus;
  getExecutor?: (type: string) => Executor;
  humanBridge?: HumanBridge;
}

export interface ExecuteRunOptions {
  canvas?: CanvasData;
  states?: EngineState[];
  edges?: ReturnType<typeof canvasToEngine>["edges"];
  nodesById?: Map<string, { id: string; data: StateNodeData }>;
  executeState?: StateExecutor;
}

const defaultBus = createEventBus();

export function createRunSupervisor(deps: SupervisorDeps = {}) {
  const store = deps.store ?? drizzleRunStore;
  const bus = deps.bus ?? defaultBus;
  const resolveExecutor = deps.getExecutor ?? getExecutor;
  const humanBridge = deps.humanBridge ?? defaultHumanBridge;
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

  function wrapExecute(
    runId: number,
    nodesById: Map<string, { id: string; data: StateNodeData }>,
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
      const ctx: ExecutorContext = {
        runId,
        state,
        node: nodesById.get(state.id),
        payload,
        signal,
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
        await emit(runId, {
          stateId: state.id,
          kind: "state.transition",
          payload: { signal: parsed.signal, toHint: parsed.toHint ?? null },
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

    const done = (async () => {
      try {
        const result = await runFsm({
          states,
          edges,
          executeState: wrapExecute(runId, nodesById, opts.executeState),
          executeChild: async () => ({ stub: true }),
          abortSignal: controller.signal,
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
          await store.updateRun(runId, {
            status: "failed",
            endedAt: new Date(),
          });
          await emit(runId, {
            stateId: result.finalStateId ?? "",
            kind: "run.failed",
            payload: { error: result.error ?? "failed" },
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

  return {
    start,
    beginRun,
    executeRun,
    cancel,
    resumeHuman,
    subscribe,
    listEventsAfter,
    getActive,
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
