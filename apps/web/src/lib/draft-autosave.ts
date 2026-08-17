import type { CanvasData } from "@/lib/fsm-types";

export const SAVE_DEBOUNCE_MS = 800;

export type SyncStatus = "idle" | "saving" | "saved" | "error" | "stale";

export type CanvasPersistV2 = {
  canvases: Record<string, CanvasData>;
  preferredSignal: string;
  revisions: Record<string, number>;
  lastSyncedAt: Record<string, number>;
  persistRole: "cache";
};

export type ServerDraftSnapshot = {
  canvas: CanvasData;
  revision: number;
  updatedAtMs: number;
};

export type HydrationDecision =
  | { kind: "empty" }
  | { kind: "import"; canvas: CanvasData }
  | { kind: "server"; canvas: CanvasData; revision: number; updatedAtMs: number }
  | { kind: "local"; canvas: CanvasData };

export function hasCanvasContent(canvas: CanvasData | undefined | null): boolean {
  if (!canvas) return false;
  return canvas.nodes.length > 0 || canvas.edges.length > 0;
}

export function toUpdatedAtMs(
  value: Date | number | string | null | undefined
): number {
  if (value == null) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") {
    return value > 0 && value < 1e12 ? value * 1000 : value;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** v0/v1 localStorage → v2 cache. Keeps nodes/edges; never treats the browser as source of truth. */
export function migrateCanvasPersist(
  persisted: unknown,
  fromVersion: number
): CanvasPersistV2 {
  const p =
    persisted && typeof persisted === "object"
      ? (persisted as Record<string, unknown>)
      : {};
  const canvases =
    p.canvases && typeof p.canvases === "object"
      ? (p.canvases as Record<string, CanvasData>)
      : {};
  const preferredSignal =
    typeof p.preferredSignal === "string" ? p.preferredSignal : "auto";

  if (fromVersion >= 2) {
    return {
      canvases,
      preferredSignal,
      revisions:
        p.revisions && typeof p.revisions === "object"
          ? (p.revisions as Record<string, number>)
          : {},
      lastSyncedAt:
        p.lastSyncedAt && typeof p.lastSyncedAt === "object"
          ? (p.lastSyncedAt as Record<string, number>)
          : {},
      persistRole: "cache",
    };
  }

  return {
    canvases,
    preferredSignal,
    revisions: {},
    lastSyncedAt: {},
    persistRole: "cache",
  };
}

/**
 * Server draft wins when its updatedAt is newer than the local cache stamp.
 * No server + local canvas → one-time import. Local newer → keep cache (do not
 * silently overwrite the server copy).
 */
export function decideHydration(input: {
  local: CanvasData | undefined;
  localSyncedAtMs: number | undefined;
  server: ServerDraftSnapshot | null;
}): HydrationDecision {
  const localHas = hasCanvasContent(input.local);
  if (!input.server) {
    if (localHas && input.local) return { kind: "import", canvas: input.local };
    return { kind: "empty" };
  }
  const localTs = input.localSyncedAtMs ?? 0;
  if (input.server.updatedAtMs > localTs) {
    return {
      kind: "server",
      canvas: input.server.canvas,
      revision: input.server.revision,
      updatedAtMs: input.server.updatedAtMs,
    };
  }
  if (localHas && input.local) return { kind: "local", canvas: input.local };
  return {
    kind: "server",
    canvas: input.server.canvas,
    revision: input.server.revision,
    updatedAtMs: input.server.updatedAtMs,
  };
}

export function createKeyedTrailingDebounce(waitMs: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  return {
    schedule(key: string, fn: () => void) {
      const existing = timers.get(key);
      if (existing) clearTimeout(existing);
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          fn();
        }, waitMs)
      );
    },
    flush(key: string, fn: () => void) {
      const existing = timers.get(key);
      if (existing) {
        clearTimeout(existing);
        timers.delete(key);
      }
      fn();
    },
    cancel(key: string) {
      const existing = timers.get(key);
      if (existing) {
        clearTimeout(existing);
        timers.delete(key);
      }
    },
    flushAll(fnForKey: (key: string) => void) {
      const keys = [...timers.keys()];
      for (const key of keys) {
        const existing = timers.get(key);
        if (existing) clearTimeout(existing);
        timers.delete(key);
        fnForKey(key);
      }
    },
    isPending(key: string) {
      return timers.has(key);
    },
    pendingKeys() {
      return [...timers.keys()];
    },
  };
}

const PERSISTENCE_CODES = [
  "STALE_REVISION",
  "DRAFT_TOO_LARGE",
  "PROJECT_MISSING",
  "NO_DRAFT",
] as const;

export type PersistenceFailure = {
  status: Extract<SyncStatus, "stale" | "error">;
  offline: boolean;
  code?: (typeof PERSISTENCE_CODES)[number];
  retryable: boolean;
};

export function classifyPersistenceFailure(err: unknown): PersistenceFailure {
  const message = err instanceof Error ? err.message : String(err);
  const explicit =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : undefined;
  const code = PERSISTENCE_CODES.find(
    (c) => explicit === c || message.includes(c)
  );
  const offline =
    (typeof navigator !== "undefined" && navigator.onLine === false) ||
    /failed to fetch|networkerror|load failed|econnrefused/i.test(message);

  if (code === "STALE_REVISION") {
    return { status: "stale", offline: false, code, retryable: false };
  }
  if (code === "DRAFT_TOO_LARGE" || code === "PROJECT_MISSING" || code === "NO_DRAFT") {
    return { status: "error", offline: false, code, retryable: false };
  }
  return { status: "error", offline, code, retryable: true };
}

export function syncBadgeLabel(
  status: SyncStatus,
  online: boolean
): "Saved" | "Saving…" | "Offline" | "error" | "" {
  if (!online) return "Offline";
  switch (status) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "error":
    case "stale":
      return "error";
    case "idle":
      return "";
  }
}

export function bindVisibilityFlush(flushAll: () => void): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return () => {};
  }
  const onVis = () => {
    if (document.visibilityState === "hidden") flushAll();
  };
  const onPageHide = () => flushAll();
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pagehide", onPageHide);
  };
}
