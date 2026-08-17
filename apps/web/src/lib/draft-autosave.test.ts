import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SAVE_DEBOUNCE_MS,
  classifyPersistenceFailure,
  createKeyedTrailingDebounce,
  decideHydration,
  hasCanvasContent,
  migrateCanvasPersist,
  syncBadgeLabel,
  toUpdatedAtMs,
} from "./draft-autosave";
import { defaultNodeData, type CanvasData, type StateNode } from "./fsm-types";

function canvas(label: string): CanvasData {
  const node: StateNode = {
    id: "S0",
    type: "stateCircle",
    position: { x: 0, y: 0 },
    data: defaultNodeData("START", label),
  };
  return { nodes: [node], edges: [] };
}

describe("createKeyedTrailingDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once after 800ms trailing, coalescing bursts", () => {
    const fn = vi.fn();
    const d = createKeyedTrailingDebounce(SAVE_DEBOUNCE_MS);
    d.schedule("p1", fn);
    d.schedule("p1", fn);
    d.schedule("p1", fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps keys independent", () => {
    const a = vi.fn();
    const b = vi.fn();
    const d = createKeyedTrailingDebounce(SAVE_DEBOUNCE_MS);
    d.schedule("a", a);
    vi.advanceTimersByTime(400);
    d.schedule("b", b);
    vi.advanceTimersByTime(400);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("flush runs immediately and cancels the pending timer", () => {
    const fn = vi.fn();
    const d = createKeyedTrailingDebounce(SAVE_DEBOUNCE_MS);
    d.schedule("p1", fn);
    d.flush("p1", fn);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("migrateCanvasPersist v1→v2", () => {
  it("preserves nodes/edges and marks the local copy as cache", () => {
    const local = canvas("Legacy");
    const migrated = migrateCanvasPersist(
      {
        canvases: { "7": local },
        preferredSignal: "::SCRIPT.NEXT",
        selectedNodeId: "S0",
      },
      0
    );
    expect(migrated.persistRole).toBe("cache");
    expect(migrated.canvases["7"]?.nodes[0]?.data.label).toBe("Legacy");
    expect(migrated.canvases["7"]?.edges).toEqual([]);
    expect(migrated.preferredSignal).toBe("::SCRIPT.NEXT");
    expect(migrated.revisions).toEqual({});
    expect(migrated.lastSyncedAt).toEqual({});
  });

  it("keeps v2 cache stamps", () => {
    const local = canvas("V2");
    const migrated = migrateCanvasPersist(
      {
        canvases: { "3": local },
        preferredSignal: "auto",
        revisions: { "3": 4 },
        lastSyncedAt: { "3": 99 },
        persistRole: "cache",
      },
      2
    );
    expect(migrated.revisions).toEqual({ "3": 4 });
    expect(migrated.lastSyncedAt).toEqual({ "3": 99 });
    expect(migrated.persistRole).toBe("cache");
  });
});

describe("decideHydration", () => {
  const local = canvas("Local");
  const serverCanvas = canvas("Server");

  it("imports local canvas when the server has no draft", () => {
    expect(
      decideHydration({
        local,
        localSyncedAtMs: undefined,
        server: null,
      })
    ).toEqual({ kind: "import", canvas: local });
  });

  it("uses the server draft when updatedAt is newer", () => {
    const decision = decideHydration({
      local,
      localSyncedAtMs: 100,
      server: { canvas: serverCanvas, revision: 2, updatedAtMs: 200 },
    });
    expect(decision).toEqual({
      kind: "server",
      canvas: serverCanvas,
      revision: 2,
      updatedAtMs: 200,
    });
  });

  it("keeps local when it is not older than the server", () => {
    expect(
      decideHydration({
        local,
        localSyncedAtMs: 500,
        server: { canvas: serverCanvas, revision: 2, updatedAtMs: 200 },
      })
    ).toEqual({ kind: "local", canvas: local });
  });

  it("stays empty when neither side has a canvas", () => {
    expect(
      decideHydration({
        local: { nodes: [], edges: [] },
        localSyncedAtMs: undefined,
        server: null,
      })
    ).toEqual({ kind: "empty" });
  });
});

describe("helpers", () => {
  it("hasCanvasContent", () => {
    expect(hasCanvasContent(undefined)).toBe(false);
    expect(hasCanvasContent({ nodes: [], edges: [] })).toBe(false);
    expect(hasCanvasContent(canvas("x"))).toBe(true);
  });

  it("toUpdatedAtMs accepts Date, ms, and unix seconds", () => {
    expect(toUpdatedAtMs(new Date(1_700_000_000_000))).toBe(1_700_000_000_000);
    expect(toUpdatedAtMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toUpdatedAtMs(1_700_000_000)).toBe(1_700_000_000_000);
  });

  it("syncBadgeLabel maps status + online", () => {
    expect(syncBadgeLabel("saved", true)).toBe("Saved");
    expect(syncBadgeLabel("saving", true)).toBe("Saving…");
    expect(syncBadgeLabel("error", false)).toBe("Offline");
    expect(syncBadgeLabel("error", true)).toBe("error");
    expect(syncBadgeLabel("idle", true)).toBe("");
  });

  it("classifyPersistenceFailure maps stale vs retryable network", () => {
    expect(
      classifyPersistenceFailure(Object.assign(new Error("STALE_REVISION"), { code: "STALE_REVISION" }))
    ).toMatchObject({ status: "stale", retryable: false });
    expect(classifyPersistenceFailure(new Error("Failed to fetch"))).toMatchObject({
      status: "error",
      retryable: true,
    });
  });
});
