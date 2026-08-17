import { and, desc, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { canvasToDsl } from "@/lib/canvas-to-dsl";
import { canonicalJson, contentHash } from "@/lib/canonical-json";
import { toUpdatedAtMs } from "@/lib/draft-autosave";
import type { CanvasData } from "@/lib/fsm-types";
import { fsmDefinitions, fsmDrafts, projects } from "@/db/schema";
import type * as schema from "@/db/schema";

export type PersistenceDb = LibSQLDatabase<typeof schema>;

export const DRAFT_MAX_BYTES = 2 * 1024 * 1024;

export type PersistenceErrorCode =
  | "STALE_REVISION"
  | "DRAFT_TOO_LARGE"
  | "PROJECT_MISSING"
  | "NO_DRAFT";

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PersistenceError";
    this.code = code;
  }
}

export type VersionRow = {
  id: number;
  version: number;
  contentHash: string;
  label: string | null;
  createdAt: Date;
};

function toVersionRow(row: typeof fsmDefinitions.$inferSelect): VersionRow {
  return {
    id: row.id,
    version: row.version,
    contentHash: row.contentHash,
    label: row.label ?? null,
    createdAt: row.createdAt,
  };
}

async function requireProject(
  db: PersistenceDb,
  projectId: number
): Promise<void> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) {
    throw new PersistenceError("PROJECT_MISSING");
  }
}

function serializedCanvas(canvas: CanvasData): string {
  const canvasJson = JSON.stringify(canvas);
  if (Buffer.byteLength(canvasJson, "utf8") > DRAFT_MAX_BYTES) {
    throw new PersistenceError(
      "DRAFT_TOO_LARGE",
      "Draft exceeds 2 MiB; split the FSM into smaller graphs."
    );
  }
  return canvasJson;
}

export async function saveDraft(
  db: PersistenceDb,
  projectId: number,
  canvas: CanvasData,
  revision: number
): Promise<{ revision: number }> {
  await requireProject(db, projectId);
  const canvasJson = serializedCanvas(canvas);
  const now = new Date();

  const [existing] = await db
    .select()
    .from(fsmDrafts)
    .where(eq(fsmDrafts.projectId, projectId))
    .limit(1);

  if (!existing) {
    const [inserted] = await db
      .insert(fsmDrafts)
      .values({
        projectId,
        canvasJson,
        revision: 1,
        updatedAt: now,
      })
      .returning({ revision: fsmDrafts.revision });
    return { revision: inserted.revision };
  }

  if (revision !== existing.revision) {
    throw new PersistenceError("STALE_REVISION");
  }

  const nextRevision = existing.revision + 1;
  const [updated] = await db
    .update(fsmDrafts)
    .set({
      canvasJson,
      revision: nextRevision,
      updatedAt: now,
    })
    .where(
      and(eq(fsmDrafts.projectId, projectId), eq(fsmDrafts.revision, revision))
    )
    .returning({ revision: fsmDrafts.revision });

  if (!updated) {
    throw new PersistenceError("STALE_REVISION");
  }

  return { revision: updated.revision };
}

export async function loadDraft(
  db: PersistenceDb,
  projectId: number
): Promise<{ canvas: CanvasData; revision: number; updatedAtMs: number } | null> {
  const [row] = await db
    .select()
    .from(fsmDrafts)
    .where(eq(fsmDrafts.projectId, projectId))
    .limit(1);
  if (!row) return null;
  return {
    canvas: JSON.parse(row.canvasJson) as CanvasData,
    revision: row.revision,
    updatedAtMs: toUpdatedAtMs(row.updatedAt),
  };
}

export async function publishVersion(
  db: PersistenceDb,
  projectId: number,
  label?: string
): Promise<VersionRow> {
  await requireProject(db, projectId);

  const draft = await loadDraft(db, projectId);
  if (!draft) {
    throw new PersistenceError("NO_DRAFT");
  }

  const dsl = canvasToDsl(draft.canvas);
  const hash = contentHash(dsl);

  const [latest] = await db
    .select()
    .from(fsmDefinitions)
    .where(eq(fsmDefinitions.projectId, projectId))
    .orderBy(desc(fsmDefinitions.version))
    .limit(1);

  if (latest && latest.contentHash === hash) {
    return toVersionRow(latest);
  }

  const nextVersion = (latest?.version ?? 0) + 1;
  const [inserted] = await db
    .insert(fsmDefinitions)
    .values({
      projectId,
      version: nextVersion,
      json: canonicalJson(dsl),
      contentHash: hash,
      label: label ?? null,
    })
    .returning();

  return toVersionRow(inserted);
}

export async function listVersions(
  db: PersistenceDb,
  projectId: number
): Promise<VersionRow[]> {
  const rows = await db
    .select()
    .from(fsmDefinitions)
    .where(eq(fsmDefinitions.projectId, projectId))
    .orderBy(desc(fsmDefinitions.version));
  return rows.map(toVersionRow);
}
