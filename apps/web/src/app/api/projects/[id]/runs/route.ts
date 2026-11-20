import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { startProjectRun } from "@/lib/run-engine";
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

  let body: { canvas?: CanvasData };
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

  try {
    const result = await startProjectRun(projectId, body.canvas);
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
