import { db } from "@/db";
import { fsmDefinitions, runEvents, runs } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  runFsm,
  type EngineEdge,
  type EngineState,
} from "@fsm/engine";
import type { CanvasData } from "@/lib/fsm-types";
import { normalizeSpawn } from "@/lib/fsm-types";
import { canvasToDsl } from "@/lib/canvas-to-dsl";

function canvasToEngine(canvas: CanvasData): {
  states: EngineState[];
  edges: EngineEdge[];
} {
  const states: EngineState[] = canvas.nodes.map((n) => {
    const base: EngineState = {
      id: n.id,
      type: n.data.stateType,
      label: n.data.label,
      onErrorSignal: n.data.onError?.signal ?? "::SCRIPT.ERROR",
      guardrails: n.data.guardrails,
    };
    if (n.data.inputSchema) {
      try {
        base.inputSchema = JSON.parse(n.data.inputSchema);
      } catch {
        /* ignore */
      }
    }
    if (n.data.stateType === "SYSTEM_FUNCTION") {
      base.mask = {
        enabledStateIds: n.data.systemFunction.enabledStateIds ?? [],
        disabledStateIds: n.data.systemFunction.disabledStateIds ?? [],
        rewire: n.data.systemFunction.rewire ?? [],
      };
    }
    if (n.data.stateType === "SPAWN") {
      const spawn = normalizeSpawn(n.data.spawn);
      base.spawn = {
        mode: spawn.mode,
        count: spawn.count,
        maxConcurrency: spawn.maxConcurrency,
        strategy: spawn.strategy,
        quorumK: spawn.quorumK,
        cancelOnParentHalt: spawn.cancelOnParentHalt,
        profiles: spawn.profiles.map((p) => ({
          id: p.id,
          toolPack: p.toolPack,
          skillPack: p.skillPack,
          timeoutMs: p.timeoutMs,
        })),
      };
    }
    if (n.data.stateType === "VALIDATE") {
      try {
        base.inputSchema = n.data.validate.schema
          ? JSON.parse(n.data.validate.schema)
          : { type: "object" };
      } catch {
        base.inputSchema = { type: "object" };
      }
    }
    return base;
  });

  const edges: EngineEdge[] = canvas.edges.map((e) => ({
    from: e.source,
    on: e.data?.signal ?? "::SCRIPT.NEXT",
    to: e.target,
    kind: e.data?.kind,
    maxIterations: e.data?.maxIterations,
  }));

  return { states, edges };
}

async function stubExecute(args: {
  state: EngineState;
  payload: unknown;
  signal: AbortSignal;
}) {
  const { state } = args;
  switch (state.type) {
    case "START":
      return "::SCRIPT.NEXT";
    case "SCRIPT":
      return "::SCRIPT.NEXT";
    case "HTTP":
      return "::HTTP.NEXT";
    case "VALIDATE":
      return "::VALIDATE.NEXT";
    case "AI":
      return "::AI.NEXT";
    case "EXTERNAL_AI":
      return "::EXTERNAL_AI.NEXT";
    case "HUMAN":
      // Stub: auto-approve in platform runs until live human bridge lands
      return "::HUMAN.APPROVE";
    case "AGGREGATE":
      return "::SCRIPT.NEXT";
    case "SYSTEM_FUNCTION":
      return "::SYSTEM.HYDRATE";
    default:
      return "::SCRIPT.NEXT";
  }
}

/**
 * Persist FSM snapshot, execute with @fsm/engine, write run_events.
 */
export async function startProjectRun(projectId: number, canvas: CanvasData) {
  // Persist the versioned FSM DSL (§10.2), not the raw React Flow canvas —
  // consumers of fsm_definitions.json expect the exported schema.
  const dsl = JSON.stringify(canvasToDsl(canvas));
  const [fsm] = await db
    .insert(fsmDefinitions)
    .values({ projectId, version: 1, json: dsl })
    .returning();

  const [run] = await db
    .insert(runs)
    .values({ fsmId: fsm.id, status: "running" })
    .returning();

  const { states, edges } = canvasToEngine(canvas);
  const result = await runFsm({
    states,
    edges,
    executeState: stubExecute,
    executeChild: async () => ({ stub: true }),
  });

  for (const ev of result.events) {
    await db.insert(runEvents).values({
      runId: run.id,
      stateId: ev.stateId,
      kind: ev.kind,
      payloadJson: JSON.stringify({
        message: ev.message,
        payload: ev.payload,
      }),
    });
  }

  await db
    .update(runs)
    .set({
      status: result.status === "succeeded" ? "succeeded" : "failed",
      endedAt: new Date(),
    })
    .where(eq(runs.id, run.id));

  return {
    runId: run.id,
    status: result.status,
    events: result.events,
    error: result.error,
    aggregate: result.aggregate,
  };
}
