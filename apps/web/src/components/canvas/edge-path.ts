import { getBezierPath, Position } from "@xyflow/react";
import type { TransitionEdgeKind } from "@/lib/fsm-types";

/** Path + label coords; self-loops get an offset loop instead of a zero-length bezier. */
export function getTransitionPath(args: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  kind?: TransitionEdgeKind;
}): [string, number, number] {
  const self =
    args.kind === "self-loop" ||
    (Math.abs(args.sourceX - args.targetX) < 1 &&
      Math.abs(args.sourceY - args.targetY) < 1);

  if (self) {
    const x = args.sourceX;
    const y = args.sourceY;
    const r = 36;
    const path = `M ${x} ${y} C ${x + r * 2} ${y - r * 2}, ${x + r * 2} ${y + r * 2}, ${x} ${y}`;
    return [path, x + r * 1.4, y];
  }

  const [path, labelX, labelY] = getBezierPath({
    sourceX: args.sourceX,
    sourceY: args.sourceY,
    sourcePosition: args.sourcePosition,
    targetX: args.targetX,
    targetY: args.targetY,
    targetPosition: args.targetPosition,
  });
  return [path, labelX, labelY];
}

export function strokeDashForKind(kind?: TransitionEdgeKind): string | undefined {
  if (kind === "router") return "4 6";
  if (kind === "self-loop") return "2 3";
  return undefined;
}
