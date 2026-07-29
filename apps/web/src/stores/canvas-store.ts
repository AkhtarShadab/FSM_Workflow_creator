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
  DEFAULT_SIGNALS,
  edgeTypeForSignal,
  type CanvasData,
  type FSMStateType,
  type StateNode,
  type StateNodeData,
  type TransitionEdge,
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
                    data: { ...e.data, signal },
                  }
                : e
            ),
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
          const sourceNode = canvas.nodes.find(
            (n) => n.id === connection.source
          );
          const signal =
            state.preferredSignal !== "auto"
              ? state.preferredSignal
              : sourceNode
                ? DEFAULT_SIGNALS[sourceNode.data.stateType]
                : "::SCRIPT.NEXT";

          const edge: TransitionEdge = {
            id: `e-${connection.source}-${connection.target}-${Date.now().toString(36)}`,
            source: connection.source,
            target: connection.target,
            sourceHandle: connection.sourceHandle,
            targetHandle: connection.targetHandle,
            type: edgeTypeForSignal(signal),
            data: { signal },
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
