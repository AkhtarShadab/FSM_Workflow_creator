/**
 * R3 — Run cursor parse/serialize and resume helpers (FeatureShipping 014).
 * Cursor is persisted as run_events.kind = "run.cursor".
 */

export const RUN_CURSOR_KIND = "run.cursor";

export interface RunCursorPayload {
  lastCompletedStateId: string;
  lastSignal: string;
  nextStateId: string;
  attempt: number;
  payloadRef: string;
  updatedAt: string;
}

export interface RunCursorEvent {
  kind: typeof RUN_CURSOR_KIND;
  stateId: string;
  payload: RunCursorPayload;
}

export interface CursorSourceEvent {
  kind: string;
  stateId?: string;
  payload?: unknown;
}

export interface ResumeFromEventsResult {
  from: string;
  warning?: "resume_without_cursor";
  cursor?: RunCursorPayload;
}

function isRunCursorPayload(value: unknown): value is RunCursorPayload {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.lastCompletedStateId === "string" &&
    typeof p.lastSignal === "string" &&
    typeof p.nextStateId === "string" &&
    typeof p.attempt === "number" &&
    typeof p.payloadRef === "string" &&
    typeof p.updatedAt === "string"
  );
}

export function parseRunCursorEvent(event: CursorSourceEvent): RunCursorEvent | null {
  if (event.kind !== RUN_CURSOR_KIND) return null;
  if (!isRunCursorPayload(event.payload)) return null;
  return {
    kind: RUN_CURSOR_KIND,
    stateId: event.stateId ?? event.payload.lastCompletedStateId,
    payload: event.payload,
  };
}

export function serializeRunCursor(
  stateId: string,
  cursor: Omit<RunCursorPayload, "updatedAt"> & { updatedAt?: string }
): RunCursorEvent {
  return {
    kind: RUN_CURSOR_KIND,
    stateId,
    payload: {
      ...cursor,
      updatedAt: cursor.updatedAt ?? new Date().toISOString(),
    },
  };
}

export function findLatestCursor(events: CursorSourceEvent[]): RunCursorPayload | null {
  let latest: RunCursorPayload | null = null;
  for (const event of events) {
    const parsed = parseRunCursorEvent(event);
    if (parsed) latest = parsed.payload;
  }
  return latest;
}

export function resumeFromEvents(events: CursorSourceEvent[]): ResumeFromEventsResult {
  const cursor = findLatestCursor(events);
  if (!cursor) {
    return { from: "START", warning: "resume_without_cursor" };
  }
  return {
    from: cursor.nextStateId,
    cursor,
  };
}
