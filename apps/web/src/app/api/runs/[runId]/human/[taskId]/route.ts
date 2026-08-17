import { NextResponse } from "next/server";
import { db } from "@/db";
import { humanTasks } from "@/db/schema";
import {
  signalForDecision,
  type HumanDecision,
} from "@/lib/executors/human-bridge";
import { runSupervisor } from "@/lib/run-supervisor";
import { and, eq } from "drizzle-orm";

function parseIds(rawRun: string, rawTask: string) {
  const runId = Number(rawRun);
  const taskId = Number(rawTask);
  if (!Number.isInteger(runId) || runId < 1) return null;
  if (!Number.isInteger(taskId) || taskId < 1) return null;
  return { runId, taskId };
}

function parseDecision(value: unknown): HumanDecision | null {
  if (value === "approve" || value === "approved") return "approved";
  if (value === "reject" || value === "rejected") return "rejected";
  return null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string; taskId: string }> }
) {
  const { runId: rawRun, taskId: rawTask } = await context.params;
  const ids = parseIds(rawRun, rawTask);
  if (!ids) {
    return NextResponse.json({ error: "Invalid run or task id" }, { status: 400 });
  }

  let body: { decision?: unknown; signal?: unknown; response?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const decision = parseDecision(body.decision);
  if (!decision) {
    return NextResponse.json(
      { error: "decision must be approve or reject" },
      { status: 400 }
    );
  }

  const signal =
    typeof body.signal === "string" && body.signal.startsWith("::HUMAN.")
      ? body.signal
      : signalForDecision(decision);

  const [task] = await db
    .select()
    .from(humanTasks)
    .where(
      and(eq(humanTasks.id, ids.taskId), eq(humanTasks.runId, ids.runId))
    )
    .limit(1);

  if (!task) {
    return NextResponse.json({ error: "Human task not found" }, { status: 404 });
  }
  if (task.status !== "pending") {
    return NextResponse.json(
      { error: "Human task is not pending", status: task.status },
      { status: 409 }
    );
  }

  const runStatus = await runSupervisor.store.getRunStatus?.(ids.runId);
  if (runStatus == null) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  await db
    .update(humanTasks)
    .set({
      status: decision,
      responseJson:
        body.response === undefined ? null : JSON.stringify(body.response),
      resolvedAt: new Date(),
    })
    .where(
      and(eq(humanTasks.id, ids.taskId), eq(humanTasks.status, "pending"))
    );

  const resumed = await runSupervisor.resumeHuman(ids.runId, ids.taskId, {
    signal,
    decision,
    response: body.response,
  });

  return NextResponse.json({
    ok: true,
    runId: ids.runId,
    taskId: ids.taskId,
    decision,
    signal,
    resumed,
  });
}
