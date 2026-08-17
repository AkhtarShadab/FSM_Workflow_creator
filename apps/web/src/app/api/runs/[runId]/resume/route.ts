import { NextResponse } from "next/server";
import { runSupervisor } from "@/lib/run-supervisor";

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const { runId: raw } = await context.params;
  const runId = Number(raw);
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  const result = await runSupervisor.resume(runId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ runId, status: "running" }, { status: 202 });
}
