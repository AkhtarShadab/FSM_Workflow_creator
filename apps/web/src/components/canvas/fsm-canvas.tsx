"use client";

import { useCallback, useMemo } from "react";
import { useTheme } from "next-themes";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useCanvasStore } from "@/stores/canvas-store";
import {
  isStateDisabledByMask,
  type StateNode,
  type TransitionEdge,
} from "@/lib/fsm-types";
import { StateCircleNode } from "./state-circle-node";
import { ScriptEdge } from "./script-edge";
import { AIEdge } from "./ai-edge";
import { SystemEdge } from "./system-edge";
import { SpawnEdge } from "./spawn-edge";
import { CanvasToolbar } from "./canvas-toolbar";
import { LintPanel } from "./lint-panel";
import { PencilDefs } from "./pencil-defs";
import { cn } from "@/lib/utils";

const nodeTypes = { stateCircle: StateCircleNode };
const edgeTypes = {
  script: ScriptEdge,
  ai: AIEdge,
  system: SystemEdge,
  spawn: SpawnEdge,
};

const EMPTY_NODES: StateNode[] = [];
const EMPTY_EDGES: TransitionEdge[] = [];

export function FsmCanvas({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const nodes = useCanvasStore((s) => s.canvases[projectId]?.nodes) ?? EMPTY_NODES;
  const edges = useCanvasStore((s) => s.canvases[projectId]?.edges) ?? EMPTY_EDGES;
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const selectEdge = useCanvasStore((s) => s.selectEdge);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";

  const displayNodes = useMemo(() => {
    const selected = nodes.find((n) => n.id === selectedNodeId);
    const mask =
      selected?.data.stateType === "SYSTEM_FUNCTION"
        ? selected.data.systemFunction
        : null;
    if (!mask) return nodes;
    return nodes.map((n) => {
      if (n.id === selected?.id) return n;
      const dimmed = isStateDisabledByMask(n.id, mask);
      if (!dimmed) return n;
      return {
        ...n,
        className: cn(n.className, "opacity-40 grayscale"),
        data: { ...n.data, dimmed: true },
      };
    });
  }, [nodes, selectedNodeId]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<StateNode>[]) => onNodesChange(projectId, changes),
    [onNodesChange, projectId]
  );
  const handleEdgesChange = useCallback(
    (changes: EdgeChange<TransitionEdge>[]) => onEdgesChange(projectId, changes),
    [onEdgesChange, projectId]
  );
  const handleConnect = useCallback(
    (connection: Connection) => onConnect(projectId, connection),
    [onConnect, projectId]
  );

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={(_, node) => selectNode(node.id)}
        onEdgeClick={(_, edge) => selectEdge(edge.id)}
        onPaneClick={() => {
          selectNode(null);
          selectEdge(null);
        }}
        deleteKeyCode={["Backspace", "Delete"]}
        colorMode={dark ? "dark" : "light"}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-[var(--paper)]"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.6}
          color={dark ? "rgba(214,211,209,0.16)" : "rgba(87,83,78,0.22)"}
        />
        <Controls className="!border-[var(--ink)]/20 !bg-[var(--paper)] [&_button]:!border-[var(--ink)]/15 [&_button]:!bg-[var(--paper)] [&_button]:!fill-[var(--ink)]" />
        <MiniMap
          pannable
          zoomable
          className="!border !border-[var(--ink)]/20 !bg-[var(--paper)]"
          nodeColor={dark ? "#57534e" : "#d6d3d1"}
          maskColor={dark ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.55)"}
        />
      </ReactFlow>

      <PencilDefs />

      <CanvasToolbar projectId={projectId} projectName={projectName} />
      <LintPanel projectId={projectId} />
    </div>
  );
}
