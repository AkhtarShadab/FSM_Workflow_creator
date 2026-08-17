import { and, asc, desc, eq, gt } from "drizzle-orm";
import { fsmDefinitions, runEvents, runs } from "@/db/schema";
import { toUpdatedAtMs } from "@/lib/draft-autosave";
import type { PersistenceDb } from "@/lib/draft-sync";

export const RUN_HISTORY_MAX_LIMIT = 200;

export type RunHistoryRow = {
  id: number;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  version: number;
  fsmId: number;
  contentHash: string;
  label: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
};

export type RunEventRow = {
  id: number;
  runId: number;
  stateId: string;
  kind: string;
  message: string;
  payload: unknown;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
  ts: string;
};

function toIso(value: Date | number | string | null | undefined): string | null {
  const ms = toUpdatedAtMs(value);
  if (!ms) return null;
  return new Date(ms).toISOString();
}

function parseTokenUsage(json: string | null): {
  tokensIn: number | null;
  tokensOut: number | null;
} {
  if (!json) return { tokensIn: null, tokensOut: null };
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const tokensIn =
      typeof parsed.tokensIn === "number"
        ? parsed.tokensIn
        : typeof parsed.in === "number"
          ? parsed.in
          : null;
    const tokensOut =
      typeof parsed.tokensOut === "number"
        ? parsed.tokensOut
        : typeof parsed.out === "number"
          ? parsed.out
          : null;
    return { tokensIn, tokensOut };
  } catch {
    return { tokensIn: null, tokensOut: null };
  }
}

function eventPayload(payloadJson: string | null): unknown {
  if (!payloadJson) return null;
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch {
    return payloadJson;
  }
}

function eventMessage(payload: unknown, fallback: string | null): string {
  if (payload && typeof payload === "object") {
    const rec = payload as { message?: unknown };
    if (typeof rec.message === "string") return rec.message;
  }
  return fallback ?? "";
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 1;
  return Math.min(Math.max(1, Math.floor(limit)), RUN_HISTORY_MAX_LIMIT);
}

export async function listRuns(
  db: PersistenceDb,
  projectId: number,
  limit: number
): Promise<RunHistoryRow[]> {
  const take = clampLimit(limit);
  const rows = await db
    .select({
      id: runs.id,
      status: runs.status,
      startedAt: runs.startedAt,
      endedAt: runs.endedAt,
      tokenUsageJson: runs.tokenUsageJson,
      fsmId: fsmDefinitions.id,
      version: fsmDefinitions.version,
      contentHash: fsmDefinitions.contentHash,
      label: fsmDefinitions.label,
    })
    .from(runs)
    .innerJoin(fsmDefinitions, eq(runs.fsmId, fsmDefinitions.id))
    .where(eq(fsmDefinitions.projectId, projectId))
    .orderBy(desc(runs.startedAt), desc(runs.id))
    .limit(take);

  return rows.map((row) => {
    const startedAt = toIso(row.startedAt) ?? new Date(0).toISOString();
    const endedAt = toIso(row.endedAt);
    const startMs = toUpdatedAtMs(row.startedAt);
    const endMs = row.endedAt ? toUpdatedAtMs(row.endedAt) : 0;
    const { tokensIn, tokensOut } = parseTokenUsage(row.tokenUsageJson);
    return {
      id: row.id,
      status: row.status,
      startedAt,
      endedAt,
      durationMs: startMs && endMs ? Math.max(0, endMs - startMs) : null,
      version: row.version,
      fsmId: row.fsmId,
      contentHash: row.contentHash,
      label: row.label ?? null,
      tokensIn,
      tokensOut,
    };
  });
}

export async function getRunEvents(
  db: PersistenceDb,
  runId: number,
  afterId?: number
): Promise<RunEventRow[]> {
  const rows = await db
    .select()
    .from(runEvents)
    .where(
      afterId != null
        ? and(eq(runEvents.runId, runId), gt(runEvents.id, afterId))
        : eq(runEvents.runId, runId)
    )
    .orderBy(asc(runEvents.id));

  return rows.map((row) => {
    const payload = eventPayload(row.payloadJson);
    return {
      id: row.id,
      runId: row.runId,
      stateId: row.stateId,
      kind: row.kind,
      message: eventMessage(payload, row.payloadJson),
      payload,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      latencyMs: row.latencyMs,
      ts: toIso(row.ts) ?? new Date(0).toISOString(),
    };
  });
}
