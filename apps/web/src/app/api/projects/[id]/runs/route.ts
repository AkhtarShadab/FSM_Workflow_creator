import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { fsmDefinitions, projects, runEvents, runs } from "@/db/schema";
import { startProjectRun } from "@/lib/run-engine";
import { parseOverrides } from "@/lib/stub-executor";
import type { CanvasData } from "@/lib/fsm-types";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  // SQLite FKs are not enforced by default, so check explicitly instead of
  // silently writing orphaned fsm_definitions / runs rows.
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: { canvas?: CanvasData; overrides?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.canvas?.nodes) || !Array.isArray(body.canvas?.edges)) {
    return NextResponse.json(
      { error: "canvas.nodes and canvas.edges required" },
      { status: 400 }
    );
  }

  const overrides = parseOverrides(body.overrides);
  if (!overrides) {
    return NextResponse.json(
      { error: "overrides must map stateId → array of ::SIGNAL strings" },
      { status: 400 }
    );
  }

  try {
    const result = await startProjectRun(projectId, body.canvas, { overrides });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Run failed",
      },
      { status: 500 }
    );
  }
}

/**
 * Run history for a project (newest first) with each run's events.
 * Query: ?limit=N (default 20, max 100).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
  const limitParam = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitParam) ? limitParam : 20));

  const rows = await db
    .select({
      id: runs.id,
      status: runs.status,
      startedAt: runs.startedAt,
      endedAt: runs.endedAt,
    })
    .from(runs)
    .innerJoin(fsmDefinitions, eq(runs.fsmId, fsmDefinitions.id))
    .where(eq(fsmDefinitions.projectId, projectId))
    .orderBy(desc(runs.id))
    .limit(limit);

  const ids = rows.map((r) => r.id);
  const events =
    ids.length > 0
      ? await db
          .select()
          .from(runEvents)
          .where(inArray(runEvents.runId, ids))
          .orderBy(runEvents.id)
      : [];

  const byRun = new Map<number, Array<{ stateId: string; kind: string; message: string }>>();
  for (const ev of events) {
    let message = "";
    try {
      message = String((JSON.parse(ev.payloadJson ?? "{}") as { message?: unknown }).message ?? "");
    } catch {
      message = ev.payloadJson ?? "";
    }
    const list = byRun.get(ev.runId) ?? [];
    list.push({ stateId: ev.stateId, kind: ev.kind, message });
    byRun.set(ev.runId, list);
  }

  return NextResponse.json({
    runs: rows.map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt?.getTime() ?? null,
      endedAt: r.endedAt?.getTime() ?? null,
      events: byRun.get(r.id) ?? [],
    })),
  });
}
