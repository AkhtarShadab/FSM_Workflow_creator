"use server";

import { db } from "@/db";
import {
  getRunEvents as getRunEventsRecord,
  listRuns as listRunsRecord,
  type RunEventRow,
  type RunHistoryRow,
} from "@/lib/run-history";

export type { RunEventRow, RunHistoryRow };

export async function listRuns(
  projectId: number,
  limit: number
): Promise<RunHistoryRow[]> {
  return listRunsRecord(db, projectId, limit);
}

export async function getRunEvents(
  runId: number,
  afterId?: number
): Promise<RunEventRow[]> {
  return getRunEventsRecord(db, runId, afterId);
}
