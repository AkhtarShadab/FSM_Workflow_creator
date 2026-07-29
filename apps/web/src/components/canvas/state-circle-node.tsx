"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Brain,
  Flag,
  GitBranch,
  Layers,
  Merge,
  Play,
  SquareTerminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { STATE_COLORS, type StateNode } from "@/lib/fsm-types";

const STATE_ICONS = {
  START: Play,
  SCRIPT: SquareTerminal,
  AI: Brain,
  SPAWN: GitBranch,
  AGGREGATE: Merge,
  SYSTEM_FUNCTION: Layers,
  END: Flag,
} as const;

function tiltFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % 997;
  return h % 2 === 0 ? "-rotate-[1.2deg]" : "rotate-[1deg]";
}

/**
 * StickyNoteNode — pastel sticky note with washi tape and a hand-written
 * label (shapeof.ai sticky pattern). Slight tilt, straightens on hover.
 */
export const StateCircleNode = memo(function StateCircleNode({
  id,
  data,
  selected,
}: NodeProps<StateNode>) {
  const colors = STATE_COLORS[data.stateType];
  const Icon = STATE_ICONS[data.stateType];

  return (
    <div
      className={cn(
        "relative w-[172px] rounded-[4px] border-2 px-3 pt-6 pb-2.5",
        "shadow-[3px_4px_0_rgba(0,0,0,0.08)] transition-all duration-200 hover:rotate-0",
        colors.note,
        colors.border,
        tiltFor(id),
        selected && "rotate-0 outline-2 outline-dashed outline-offset-4 outline-[var(--ink)]"
      )}
    >
      {/* washi tape */}
      <div
        className={cn(
          "absolute -top-2.5 left-1/2 h-5 w-16 -translate-x-1/2 -rotate-[3deg] rounded-[2px] shadow-sm",
          colors.tape
        )}
      />

      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !rounded-full !border-0 !bg-[var(--ink)]"
      />

      <div className={cn("flex items-center gap-1.5", colors.text)}>
        <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
        <span className="text-[9px] font-bold tracking-[0.14em] uppercase">
          {data.stateType}
        </span>
      </div>

      <div
        className={cn(
          "font-hand mt-0.5 text-[24px] leading-[1.05] font-bold break-words",
          colors.text
        )}
      >
        {data.label}
      </div>

      {data.description && (
        <p
          className={cn(
            "mt-1 line-clamp-2 text-[10px] leading-snug opacity-75",
            colors.text
          )}
        >
          {data.description}
        </p>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !rounded-full !border-0 !bg-[var(--ink)]"
      />
    </div>
  );
});
