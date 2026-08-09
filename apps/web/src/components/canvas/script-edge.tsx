"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
} from "@xyflow/react";
import { BeamDot, PencilEdgeLabel } from "./pencil-defs";
import { getTransitionPath, strokeDashForKind } from "./edge-path";
import type { TransitionEdgeKind } from "@/lib/fsm-types";

/** ScriptEdge — bold pencil stroke (deterministic transitions) */
export function ScriptEdge({
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
          strokeWidth: selected ? 5 : 4,
          strokeLinecap: "round",
          strokeDasharray: strokeDashForKind(kind),
          filter: "url(#pencil-rough)",
        }}
      />
      {data?.signal && (
        <EdgeLabelRenderer>
          <PencilEdgeLabel x={labelX} y={labelY} text={String(data.signal)} />
        </EdgeLabelRenderer>
      )}
      <BeamDot path={edgePath} color="#78716c" seed={id} />
    </>
  );
}
