"use server";

import { db } from "@/db";
import { listExportJobs as listExportJobsRecord } from "@/lib/export/zip-harness";

export async function listExportJobs(projectId: number) {
  return listExportJobsRecord(db, projectId);
}
