"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  listVersions as listVersionsRecord,
  loadDraft as loadDraftRecord,
  publishVersion as publishVersionRecord,
  saveDraft as saveDraftRecord,
} from "@/lib/draft-sync";
import type { CanvasData } from "@/lib/fsm-types";

export async function saveDraft(
  projectId: number,
  canvas: CanvasData,
  revision: number
): Promise<{ revision: number }> {
  const result = await saveDraftRecord(db, projectId, canvas, revision);
  revalidatePath(`/project/${projectId}`);
  return result;
}

export async function loadDraft(
  projectId: number
): Promise<{ canvas: CanvasData; revision: number } | null> {
  return loadDraftRecord(db, projectId);
}

export async function publishVersion(projectId: number, label?: string) {
  const result = await publishVersionRecord(db, projectId, label);
  revalidatePath(`/project/${projectId}`);
  return result;
}

export async function listVersions(projectId: number) {
  return listVersionsRecord(db, projectId);
}
