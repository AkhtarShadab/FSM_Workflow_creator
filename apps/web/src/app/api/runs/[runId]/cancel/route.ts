import { NextResponse } from "next/server";
import { runSupervisor } from "@/lib/run-supervisor";

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const { runId: raw } = await context.params;
  const runId = Number(raw);
  if (!Number.isInteger(runId) || runId < 1) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  const status = await runSupervisor.store.getRunStatus?.(runId);
  if (status == null) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const cancelled = runSupervisor.cancel(runId);
  return NextResponse.json({ cancelled });
}
