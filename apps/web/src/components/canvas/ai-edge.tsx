"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
} from "@xyflow/react";
import { BeamDot, PencilEdgeLabel } from "./pencil-defs";
import { getTransitionPath } from "./edge-path";
import type { TransitionEdgeKind } from "@/lib/fsm-types";

/** AIEdge — dashed pencil stroke (generative transitions) */
export function AIEdge({
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
          strokeDasharray: kind === "router" ? "4 6" : "9 7",
          strokeLinecap: "round",
          filter: "url(#pencil-rough)",
        }}
      />
      {data?.signal && (
        <EdgeLabelRenderer>
          <PencilEdgeLabel x={labelX} y={labelY} text={String(data.signal)} />
        </EdgeLabelRenderer>
      )}
      <BeamDot path={edgePath} color="#d670a7" seed={id} />
    </>
  );
}
