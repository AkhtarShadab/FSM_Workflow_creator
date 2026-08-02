"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
} from "@xyflow/react";
import { BeamDot, PencilEdgeLabel } from "./pencil-defs";
import { getTransitionPath } from "./edge-path";
import type { TransitionEdgeKind } from "@/lib/fsm-types";

/** SpawnEdge — dash-dot pencil stroke (SPAWN.* fan-out signals) */
export function SpawnEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const kind = data?.kind as TransitionEdgeKind | undefined;
  const [edgePath, labelX, labelY] = getTransitionPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    kind,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: "var(--ink)",
          strokeWidth: selected ? 4 : 3,
          strokeDasharray: kind === "router" ? "4 6" : "12 5 2 5",
          strokeLinecap: "round",
          filter: "url(#pencil-rough)",
        }}
      />
      {data?.signal && (
        <EdgeLabelRenderer>
          <PencilEdgeLabel x={labelX} y={labelY} text={String(data.signal)} />
        </EdgeLabelRenderer>
      )}
      <BeamDot path={edgePath} color="#d9a441" seed={id} />
    </>
  );
}
