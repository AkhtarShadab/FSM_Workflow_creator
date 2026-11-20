import { db } from "@/db";
import { fsmDefinitions, runEvents, runs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runFsm, type EngineState } from "@fsm/engine";
import type { CanvasData } from "@/lib/fsm-types";
import { canvasToDsl } from "@/lib/canvas-to-dsl";
import { canvasToEngine } from "@/lib/canvas-to-engine";

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

  let result: Awaited<ReturnType<typeof runFsm>>;
  try {
    const { states, edges } = canvasToEngine(canvas);
    result = await runFsm({
      states,
      edges,
      executeState: stubExecute,
      executeChild: async () => ({ stub: true }),
    });

    if (result.events.length > 0) {
      await db.insert(runEvents).values(
        result.events.map((ev) => ({
          runId: run.id,
          stateId: ev.stateId,
          kind: ev.kind,
          payloadJson: JSON.stringify({
            message: ev.message,
            payload: ev.payload,
          }),
        }))
      );
    }
    if (result.error) {
      await db.insert(runEvents).values({
        runId: run.id,
        stateId: result.finalStateId ?? "engine",
        kind: "ERROR",
        payloadJson: JSON.stringify({ message: result.error }),
      });
    }
  } catch (err) {
    // Never leave a run stuck in "running" if the engine or DB throws.
    await db
      .update(runs)
      .set({ status: "failed", endedAt: new Date() })
      .where(eq(runs.id, run.id));
    throw err;
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
