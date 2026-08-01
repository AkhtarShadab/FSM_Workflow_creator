"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { BeamDot, PencilEdgeLabel } from "./pencil-defs";

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
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
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
          strokeDasharray: "9 7",
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
