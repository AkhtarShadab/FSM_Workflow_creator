"use server";

import { db } from "@/db";
import {
  getRunEvents as getRunEventsRecord,
  listRuns as listRunsRecord,
} from "@/lib/run-history";

export async function listRuns(projectId: number, limit: number) {
  return listRunsRecord(db, projectId, limit);
}

export async function getRunEvents(runId: number, afterId?: number) {
  return getRunEventsRecord(db, runId, afterId);
}
