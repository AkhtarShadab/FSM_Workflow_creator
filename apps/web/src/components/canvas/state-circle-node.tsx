"use client";

import { memo } from "react";
import {
  Handle,
  Position,
  useNodes,
  type NodeProps,
} from "@xyflow/react";
import {
  Brain,
  Cloud,
  Flag,
  GitBranch,
  Globe,
  Layers,
  Merge,
  Play,
  ShieldCheck,
  SquareTerminal,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  normalizeAggregate,
  normalizeSpawn,
  normalizeSystemFunction,
  primaryProfile,
  spawnWorkerCount,
  STATE_COLORS,
  type RouterHead,
  type StateNode,
} from "@/lib/fsm-types";

const STATE_ICONS = {
  START: Play,
  SCRIPT: SquareTerminal,
  HTTP: Globe,
  AI: Brain,
  EXTERNAL_AI: Cloud,
  VALIDATE: ShieldCheck,
  HUMAN: UserRound,
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
  const dimmed = Boolean(data.dimmed);
  const sf =
    data.stateType === "SYSTEM_FUNCTION"
      ? normalizeSystemFunction(data.systemFunction)
      : null;

  return (
    <div
      className={cn(
        "relative w-[172px] rounded-[4px] border-2 px-3 pt-6 pb-2.5",
        "shadow-[3px_4px_0_rgba(0,0,0,0.08)] transition-all duration-200 hover:rotate-0",
        colors.note,
        colors.border,
        tiltFor(id),
        selected && "rotate-0 outline-2 outline-dashed outline-offset-4 outline-[var(--ink)]",
        dimmed && "opacity-40 grayscale"
      )}
      data-testid={`state-node-${data.stateType}`}
      data-dimmed={dimmed ? "true" : undefined}
    >
      {/* washi tape */}
      <div
        className={cn(
          "absolute -top-2.5 left-1/2 h-5 w-16 -translate-x-1/2 -rotate-[3deg] rounded-[2px] shadow-sm",
          colors.tape
        )}
      />

      <Handle
        id="default-target"
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !rounded-full !border-0 !bg-[var(--ink)]"
      />

      {sf &&
        sf.heads.map((head, i) => (
          <RouterHeadHandles key={head.id} head={head} index={i} total={sf.heads.length} />
        ))}

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

      {data.stateType === "SPAWN" && (
        <SpawnChips data={data} textClass={colors.text} />
      )}
      {data.stateType === "AGGREGATE" && (
        <AggregateChips nodeId={id} data={data} textClass={colors.text} />
      )}
      {data.stateType === "SYSTEM_FUNCTION" && sf && sf.heads.length > 0 && (
        <div className={cn("mt-1.5 flex flex-wrap gap-1", colors.text)}>
          <span className="rounded-[2px] border border-current/25 bg-black/5 px-1 py-0.5 text-[8px] font-bold tracking-wide uppercase opacity-80">
            {sf.heads.length} heads
          </span>
        </div>
      )}

      <Handle
        id="default-source"
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !rounded-full !border-0 !bg-[var(--ink)]"
      />
    </div>
  );
});

function RouterHeadHandles({
  head,
  index,
  total,
}: {
  head: RouterHead;
  index: number;
  total: number;
}) {
  const topPct = `${((index + 1) / (total + 1)) * 100}%`;
  const showIn = head.direction === "in" || head.direction === "bidirectional";
  const showOut = head.direction === "out" || head.direction === "bidirectional";

  return (
    <>
      {showIn && (
        <Handle
          id={`head-in-${head.id}`}
          type="target"
          position={Position.Top}
          style={{ left: topPct }}
          className="!h-2 !w-2 !rounded-sm !border !border-violet-600 !bg-violet-400"
          title={head.label}
        />
      )}
      {showOut && (
        <Handle
          id={`head-out-${head.id}`}
          type="source"
          position={Position.Bottom}
          style={{ left: topPct }}
          className="!h-2 !w-2 !rounded-sm !border !border-violet-600 !bg-violet-400"
          title={head.label}
        />
      )}
    </>
  );
}

function SpawnChips({
  data,
  textClass,
}: {
  data: StateNode["data"];
  textClass: string;
}) {
  const spawn = normalizeSpawn(data.spawn);
  const profile = primaryProfile(spawn);
  const x = spawnWorkerCount(spawn);
  return (
    <div className={cn("mt-1.5 flex flex-wrap gap-1", textClass)}>
      <span className="rounded-[2px] border border-current/25 bg-black/5 px-1 py-0.5 text-[8px] font-bold tracking-wide uppercase opacity-80">
        1→{x} · max {spawn.maxConcurrency}
      </span>
      <span className="rounded-[2px] border border-current/25 bg-black/5 px-1 py-0.5 text-[8px] font-bold tracking-wide uppercase opacity-80">
        {profile.toolPack.length} tools
      </span>
      <span className="rounded-[2px] border border-current/25 bg-black/5 px-1 py-0.5 text-[8px] font-bold tracking-wide uppercase opacity-80">
        {profile.skillPack.length} skills
      </span>
    </div>
  );
}

function AggregateChips({
  nodeId,
  data,
  textClass,
}: {
  nodeId: string;
  data: StateNode["data"];
  textClass: string;
}) {
  const nodes = useNodes() as StateNode[];
  const aggregate = normalizeAggregate(data.aggregate);
  const spawn =
    nodes.find((n) => n.id === aggregate.fromSpawnId) ??
    nodes.find(
      (n) =>
        n.data.stateType === "SPAWN" &&
        normalizeSpawn(n.data.spawn).aggregateTo === nodeId
    );
  if (!spawn) {
    return (
      <div className={cn("mt-1.5 flex flex-wrap gap-1", textClass)}>
        <span className="rounded-[2px] border border-current/25 bg-black/5 px-1 py-0.5 text-[8px] font-bold tracking-wide uppercase opacity-60">
          unpaired
        </span>
      </div>
    );
  }
  const x = spawnWorkerCount(normalizeSpawn(spawn.data.spawn));
  return (
    <div className={cn("mt-1.5 flex flex-wrap gap-1", textClass)}>
      <span className="rounded-[2px] border border-current/25 bg-black/5 px-1 py-0.5 text-[8px] font-bold tracking-wide uppercase opacity-80">
        ← {x} from {spawn.data.label}
      </span>
    </div>
  );
}
