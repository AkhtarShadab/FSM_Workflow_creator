import { NextResponse } from "next/server";
import { startProjectRun } from "@/lib/run-engine";
import type { CanvasData } from "@/lib/fsm-types";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const projectId = Number(id);
  if (!Number.isFinite(projectId)) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  let body: { canvas?: CanvasData };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.canvas?.nodes || !body.canvas?.edges) {
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
