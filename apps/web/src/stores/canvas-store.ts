"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import {
  listVersions,
  loadDraft,
  publishVersion,
  restoreVersion,
  saveDraft,
} from "@/app/project/[id]/actions";
import {
  SAVE_DEBOUNCE_MS,
  bindVisibilityFlush,
  classifyPersistenceFailure,
  createKeyedTrailingDebounce,
  decideHydration,
  migrateCanvasPersist,
  type SyncStatus,
} from "@/lib/draft-autosave";
import {
  defaultNodeData,
  DEFAULT_SELF_LOOP_MAX_ITERATIONS,
  DEFAULT_SIGNALS,
  edgeTypeForSignal,
  normalizeEdgeData,
  type CanvasData,
  type FSMStateType,
  type StateNode,
  type StateNodeData,
  type TransitionEdge,
  type TransitionEdgeData,
} from "@/lib/fsm-types";

let counter = 0;
function nextId(type: FSMStateType) {
  counter += 1;
  return `${type === "START" ? "S0" : `S${type.slice(0, 2)}${counter}`}_${Date.now().toString(36)}`;
}

const EMPTY: CanvasData = { nodes: [], edges: [] };
const MAX_BACKOFF_ATTEMPTS = 3;

const debouncer = createKeyedTrailingDebounce(SAVE_DEBOUNCE_MS);
const inflight = new Set<string>();
const queued = new Set<string>();
const backoffAttempt = new Map<string, number>();
const hydrateInflight = new Map<string, Promise<void>>();
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

export type { SyncStatus };

interface CanvasStore {
  canvases: Record<string, CanvasData>;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  /** "auto" = derive from source state type; otherwise a signal preset (§6.1) */
  preferredSignal: string;
  persistRole: "cache";
  syncStatus: SyncStatus;
  revisions: Record<string, number>;
  lastSyncedAt: Record<string, number>;
  versionCounts: Record<string, number>;
  notice: string | null;

  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  setPreferredSignal: (signal: string) => void;
  getCanvas: (projectId: string) => CanvasData;

  addNode: (
    projectId: string,
    type: FSMStateType,
    position: { x: number; y: number },
    label?: string
  ) => string;
  removeNode: (projectId: string, nodeId: string) => void;
  updateNodeData: (
    projectId: string,
    nodeId: string,
    patch: Partial<StateNodeData>
  ) => void;
  updateEdgeSignal: (projectId: string, edgeId: string, signal: string) => void;
  updateEdgeData: (
    projectId: string,
    edgeId: string,
    patch: Partial<TransitionEdgeData>
  ) => void;
  addTransition: (
    projectId: string,
    source: string,
    target: string,
    signal: string
  ) => void;
  removeEdge: (projectId: string, edgeId: string) => void;

  onNodesChange: (projectId: string, changes: NodeChange<StateNode>[]) => void;
  onEdgesChange: (
    projectId: string,
    changes: EdgeChange<TransitionEdge>[]
  ) => void;
  onConnect: (projectId: string, connection: Connection) => void;

  clearCanvas: (projectId: string) => void;
  scheduleSave: (projectId: string) => void;
  flushSave: (projectId: string) => Promise<void>;
  flushPendingSaves: () => void;
  hydrateFromServer: (projectId: string) => Promise<void>;
  reloadFromServer: (projectId: string) => Promise<void>;
  overwriteServer: (projectId: string) => Promise<void>;
  publishProject: (projectId: string, label?: string) => Promise<void>;
  restoreProjectVersion: (
    projectId: string,
    versionId: number
  ) => Promise<void>;
  clearNotice: () => void;
}

function setCanvas(
  state: Pick<CanvasStore, "canvases">,
  projectId: string,
  data: CanvasData
) {
  return { canvases: { ...state.canvases, [projectId]: data } };
}

function isStructuralNodeChange(changes: NodeChange<StateNode>[]) {
  return changes.some((c) => c.type !== "select" && c.type !== "dimensions");
}

function isStructuralEdgeChange(changes: EdgeChange<TransitionEdge>[]) {
  return changes.some((c) => c.type !== "select");
}

function numericProjectId(projectId: string): number {
  const id = Number(projectId);
  if (!Number.isFinite(id)) {
    throw new Error(`Invalid project id: ${projectId}`);
  }
  return id;
}

function flashNotice(message: string) {
  if (noticeTimer) clearTimeout(noticeTimer);
  useCanvasStore.setState({ notice: message });
  noticeTimer = setTimeout(() => {
    useCanvasStore.setState({ notice: null });
    noticeTimer = null;
  }, 4000);
}

function resetBackoff(projectId: string) {
  backoffAttempt.delete(projectId);
}

function scheduleBackoffRetry(projectId: string) {
  const n = backoffAttempt.get(projectId) ?? 0;
  if (n >= MAX_BACKOFF_ATTEMPTS) return;
  backoffAttempt.set(projectId, n + 1);
  const delay = 2000 * 2 ** n;
  setTimeout(() => {
    void persistDraft(projectId);
  }, delay);
}

async function persistDraft(projectId: string): Promise<void> {
  if (inflight.has(projectId)) {
    queued.add(projectId);
    return;
  }
  inflight.add(projectId);
  useCanvasStore.setState({ syncStatus: "saving" });
  try {
    const state = useCanvasStore.getState();
    const canvas = state.canvases[projectId] ?? EMPTY;
    const revision = state.revisions[projectId] ?? 0;
    const result = await saveDraft(numericProjectId(projectId), canvas, revision);
    resetBackoff(projectId);
    useCanvasStore.setState((s) => ({
      revisions: { ...s.revisions, [projectId]: result.revision },
      lastSyncedAt: { ...s.lastSyncedAt, [projectId]: Date.now() },
      syncStatus: "saved",
    }));
  } catch (err) {
    const classified = classifyPersistenceFailure(err);
    useCanvasStore.setState({ syncStatus: classified.status });
    if (classified.retryable) scheduleBackoffRetry(projectId);
  } finally {
    inflight.delete(projectId);
    if (queued.has(projectId)) {
      queued.delete(projectId);
      await persistDraft(projectId);
    }
  }
}

function waitForInflight(projectId: string): Promise<void> {
  if (!inflight.has(projectId)) return Promise.resolve();
  return new Promise((resolve) => {
    const tick = () => {
      if (!inflight.has(projectId)) resolve();
      else setTimeout(tick, 20);
    };
    tick();
  });
}

export const useCanvasStore = create<CanvasStore>()(
  persist(
    (set, get) => ({
      canvases: {},
      selectedNodeId: null,
      selectedEdgeId: null,
      preferredSignal: "auto",
      persistRole: "cache",
      syncStatus: "idle",
      revisions: {},
      lastSyncedAt: {},
      versionCounts: {},
      notice: null,

      selectNode: (id) => set({ selectedNodeId: id, selectedEdgeId: null }),
      selectEdge: (id) => set({ selectedEdgeId: id, selectedNodeId: null }),
      setPreferredSignal: (signal) => set({ preferredSignal: signal }),

      getCanvas: (projectId) => get().canvases[projectId] ?? EMPTY,

      addNode: (projectId, type, position, label) => {
        const id = nextId(type);
        const node: StateNode = {
          id,
          type: "stateCircle",
          position,
          data: defaultNodeData(type, label ?? type),
        };
        set((state) => {
          const canvas = state.canvases[projectId] ?? EMPTY;
          return setCanvas(state, projectId, {
            ...canvas,
            nodes: [...canvas.nodes, node],
          });
        });
        get().scheduleSave(projectId);
        return id;
      },

      removeNode: (projectId, nodeId) => {
        set((state) => {
          const canvas = state.canvases[projectId] ?? EMPTY;
          return {
            ...setCanvas(state, projectId, {
              nodes: canvas.nodes.filter((n) => n.id !== nodeId),
              edges: canvas.edges.filter(
                (e) => e.source !== nodeId && e.target !== nodeId
              ),
            }),
            selectedNodeId:
              state.selectedNodeId === nodeId ? null : state.selectedNodeId,
          };
        });
        get().scheduleSave(projectId);
      },

      updateNodeData: (projectId, nodeId, patch) => {
        set((state) => {
          const canvas = state.canvases[projectId] ?? EMPTY;
          return setCanvas(state, projectId, {
            ...canvas,
            nodes: canvas.nodes.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n
            ),
          });
        });
        get().scheduleSave(projectId);
      },

      updateEdgeSignal: (projectId, edgeId, signal) => {
        set((state) => {
          const canvas = state.canvases[projectId] ?? EMPTY;
          return setCanvas(state, projectId, {
            ...canvas,
            edges: canvas.edges.map((e) =>
              e.id === edgeId
                ? {
                    ...e,
                    type: edgeTypeForSignal(signal),
                    label: signal,
                    data: normalizeEdgeData(
                      { ...e.data, signal },
                      e.source,
                      e.target
                    ),
                  }
                : e
            ),
          });
        });
        get().scheduleSave(projectId);
      },

      updateEdgeData: (projectId, edgeId, patch) => {
        set((state) => {
          const canvas = state.canvases[projectId] ?? EMPTY;
          return setCanvas(state, projectId, {
            ...canvas,
            edges: canvas.edges.map((e) => {
              if (e.id !== edgeId) return e;
              const data = normalizeEdgeData(
                { ...e.data, ...patch },
                e.source,
                e.target
              );
              return {
                ...e,
                type: edgeTypeForSignal(data.signal),
                label: data.signal,
                data,
              };
            }),
          });
        });
        get().scheduleSave(projectId);
      },

      addTransition: (projectId, source, target, signal) => {
        set((state) => {
          const canvas = state.canvases[projectId] ?? EMPTY;
          const kind = source === target ? "self-loop" : "transition";
          const data = normalizeEdgeData(
            {
              signal,
              kind,
              ...(kind === "self-loop"
                ? { maxIterations: DEFAULT_SELF_LOOP_MAX_ITERATIONS }
                : {}),
            },
            source,
            target
          );
          const edge: TransitionEdge = {
            id: `e-${source}-${target}-${Date.now().toString(36)}`,
            source,
            target,
            type: edgeTypeForSignal(signal),
            data,
            label: signal,
          };
          return setCanvas(state, projectId, {
            ...canvas,
            edges: [...canvas.edges, edge],
          });
        });
        get().scheduleSave(projectId);
      },

      removeEdge: (projectId, edgeId) => {
        set((state) => {
          const canvas = state.canvases[projectId] ?? EMPTY;
          return {
            ...setCanvas(state, projectId, {
              ...canvas,
              edges: canvas.edges.filter((e) => e.id !== edgeId),
            }),
            selectedEdgeId:
              state.selectedEdgeId === edgeId ? null : state.selectedEdgeId,
          };
        });
        get().scheduleSave(projectId);
      },

      onNodesChange: (projectId, changes) => {
        set((state) => {
          const canvas = state.canvases[projectId] ?? EMPTY;
          return setCanvas(state, projectId, {
            ...canvas,
            nodes: applyNodeChanges(changes, canvas.nodes),
          });
        });
        if (isStructuralNodeChange(changes)) get().scheduleSave(projectId);
      },

      onEdgesChange: (projectId, changes) => {
        set((state) => {
          const canvas = state.canvases[projectId] ?? EMPTY;
          return setCanvas(state, projectId, {
            ...canvas,
            edges: applyEdgeChanges(changes, canvas.edges),
          });
        });
        if (isStructuralEdgeChange(changes)) get().scheduleSave(projectId);
      },

      onConnect: (projectId, connection) => {
        set((state) => {
          const canvas = state.canvases[projectId] ?? EMPTY;
          if (!connection.source || !connection.target) return state;

          const sourceNode = canvas.nodes.find(
            (n) => n.id === connection.source
          );
          const targetNode = canvas.nodes.find(
            (n) => n.id === connection.target
          );
          const signal =
            state.preferredSignal !== "auto"
              ? state.preferredSignal
              : sourceNode
                ? DEFAULT_SIGNALS[sourceNode.data.stateType]
                : "::SCRIPT.NEXT";

          const sourceHandle = connection.sourceHandle ?? undefined;
          const targetHandle = connection.targetHandle ?? undefined;
          const isSelf = connection.source === connection.target;
          const isRouterHandle =
            (sourceHandle &&
              sourceNode?.data.stateType === "SYSTEM_FUNCTION" &&
              sourceHandle !== "default-source") ||
            (targetHandle &&
              targetNode?.data.stateType === "SYSTEM_FUNCTION" &&
              targetHandle !== "default-target");

          const kind = isSelf
            ? "self-loop"
            : isRouterHandle
              ? "router"
              : "transition";

          const data = normalizeEdgeData(
            {
              signal,
              kind,
              ...(kind === "self-loop"
                ? { maxIterations: DEFAULT_SELF_LOOP_MAX_ITERATIONS }
                : {}),
            },
            connection.source,
            connection.target
          );

          const edge: TransitionEdge = {
            id: `e-${connection.source}-${connection.target}-${Date.now().toString(36)}`,
            source: connection.source,
            target: connection.target,
            sourceHandle,
            targetHandle,
            type: edgeTypeForSignal(signal),
            data,
            label: signal,
          };
          return setCanvas(state, projectId, {
            ...canvas,
            edges: [...canvas.edges, edge],
          });
        });
        if (connection.source && connection.target) {
          get().scheduleSave(projectId);
        }
      },

      clearCanvas: (projectId) => {
        set((state) => ({
          ...setCanvas(state, projectId, EMPTY),
          selectedNodeId: null,
          selectedEdgeId: null,
        }));
        get().scheduleSave(projectId);
      },

      scheduleSave: (projectId) => {
        debouncer.schedule(projectId, () => {
          void persistDraft(projectId);
        });
      },

      flushSave: async (projectId) => {
        if (debouncer.isPending(projectId) || queued.has(projectId)) {
          debouncer.cancel(projectId);
          queued.delete(projectId);
          await persistDraft(projectId);
          return;
        }
        await waitForInflight(projectId);
      },

      flushPendingSaves: () => {
        debouncer.flushAll((projectId) => {
          void persistDraft(projectId);
        });
      },

      hydrateFromServer: (projectId) => {
        const existing = hydrateInflight.get(projectId);
        if (existing) return existing;
        const run = (async () => {
          try {
            const id = numericProjectId(projectId);
            const [server, versions] = await Promise.all([
              loadDraft(id),
              listVersions(id).catch(() => []),
            ]);
            const state = get();
            const decision = decideHydration({
              local: state.canvases[projectId],
              localSyncedAtMs: state.lastSyncedAt[projectId],
              server: server
                ? {
                    canvas: server.canvas,
                    revision: server.revision,
                    updatedAtMs: server.updatedAtMs,
                  }
                : null,
            });

            set((s) => ({
              versionCounts: {
                ...s.versionCounts,
                [projectId]: versions.length,
              },
            }));

            if (decision.kind === "server") {
              set((s) => ({
                ...setCanvas(s, projectId, decision.canvas),
                revisions: { ...s.revisions, [projectId]: decision.revision },
                lastSyncedAt: {
                  ...s.lastSyncedAt,
                  [projectId]: decision.updatedAtMs,
                },
                syncStatus: "saved",
              }));
              return;
            }

            if (decision.kind === "import") {
              flashNotice("Imported local canvas");
              await persistDraft(projectId);
              return;
            }

            if (decision.kind === "local") {
              get().scheduleSave(projectId);
              return;
            }

            set({ syncStatus: "idle" });
          } catch (err) {
            const classified = classifyPersistenceFailure(err);
            set({ syncStatus: classified.status });
          }
        })();
        hydrateInflight.set(projectId, run);
        return run;
      },

      reloadFromServer: async (projectId) => {
        const server = await loadDraft(numericProjectId(projectId));
        if (!server) return;
        set((s) => ({
          ...setCanvas(s, projectId, server.canvas),
          revisions: { ...s.revisions, [projectId]: server.revision },
          lastSyncedAt: { ...s.lastSyncedAt, [projectId]: server.updatedAtMs },
          syncStatus: "saved",
        }));
      },

      overwriteServer: async (projectId) => {
        const server = await loadDraft(numericProjectId(projectId));
        const revision = server?.revision ?? 0;
        set((s) => ({
          revisions: { ...s.revisions, [projectId]: revision },
        }));
        await persistDraft(projectId);
      },

      publishProject: async (projectId, label) => {
        await get().flushSave(projectId);
        await publishVersion(numericProjectId(projectId), label);
        const versions = await listVersions(numericProjectId(projectId));
        set((s) => ({
          versionCounts: { ...s.versionCounts, [projectId]: versions.length },
          syncStatus: s.syncStatus === "idle" ? "saved" : s.syncStatus,
        }));
      },

      restoreProjectVersion: async (projectId, versionId) => {
        debouncer.cancel(projectId);
        queued.delete(projectId);
        await waitForInflight(projectId);
        const result = await restoreVersion(
          numericProjectId(projectId),
          versionId
        );
        set((s) => ({
          ...setCanvas(s, projectId, result.canvas),
          revisions: { ...s.revisions, [projectId]: result.revision },
          lastSyncedAt: { ...s.lastSyncedAt, [projectId]: Date.now() },
          syncStatus: "saved",
          selectedNodeId: null,
          selectedEdgeId: null,
        }));
      },

      clearNotice: () => set({ notice: null }),
    }),
    {
      name: "fsm-canvas-store",
      version: 2,
      migrate: (persisted, version) => migrateCanvasPersist(persisted, version),
      partialize: (state) => ({
        canvases: state.canvases,
        preferredSignal: state.preferredSignal,
        revisions: state.revisions,
        lastSyncedAt: state.lastSyncedAt,
        persistRole: "cache" as const,
      }),
    }
  )
);

if (typeof window !== "undefined") {
  bindVisibilityFlush(() => {
    useCanvasStore.getState().flushPendingSaves();
  });
}
