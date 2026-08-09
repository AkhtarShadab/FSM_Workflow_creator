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

interface CanvasStore {
  canvases: Record<string, CanvasData>;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  /** "auto" = derive from source state type; otherwise a signal preset (§6.1) */
  preferredSignal: string;

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
}

function setCanvas(
  state: Pick<CanvasStore, "canvases">,
  projectId: string,
  data: CanvasData
) {
  return { canvases: { ...state.canvases, [projectId]: data } };
}

export const useCanvasStore = create<CanvasStore>()(
  persist(
    (set, get) => ({
      canvases: {},
      selectedNodeId: null,
      selectedEdgeId: null,
      preferredSignal: "auto",

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
        return id;
      },

      removeNode: (projectId, nodeId) =>
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
        }),

      updateNodeData: (projectId, nodeId, patch) =>
        set((state) => {
          const canvas = state.canvases[projectId] ?? EMPTY;
          return setCanvas(state, projectId, {
            ...canvas,
            nodes: canvas.nodes.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n
            ),
          });
        }),

      updateEdgeSignal: (projectId, edgeId, signal) =>
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
        }),

      updateEdgeData: (projectId, edgeId, patch) =>
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
        }),

      addTransition: (projectId, source, target, signal) =>
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
        }),

      removeEdge: (projectId, edgeId) =>
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
        }),

      onNodesChange: (projectId, changes) =>
        set((state) => {
          const canvas = state.canvases[projectId] ?? EMPTY;
          return setCanvas(state, projectId, {
            ...canvas,
            nodes: applyNodeChanges(changes, canvas.nodes),
          });
        }),

      onEdgesChange: (projectId, changes) =>
        set((state) => {
          const canvas = state.canvases[projectId] ?? EMPTY;
          return setCanvas(state, projectId, {
            ...canvas,
            edges: applyEdgeChanges(changes, canvas.edges),
          });
        }),

      onConnect: (projectId, connection) =>
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
        }),

      clearCanvas: (projectId) =>
        set((state) => ({
          ...setCanvas(state, projectId, EMPTY),
          selectedNodeId: null,
          selectedEdgeId: null,
        })),
    }),
    { name: "fsm-canvas-store" }
  )
);
