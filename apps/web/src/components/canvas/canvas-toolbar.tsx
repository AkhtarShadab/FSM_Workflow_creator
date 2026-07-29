"use client";

import { useReactFlow } from "@xyflow/react";
import {
  Brain,
  Flag,
  GitBranch,
  Layers,
  Merge,
  Play,
  SquareTerminal,
  Spline,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  SIGNAL_PRESETS,
  STATE_COLORS,
  type FSMStateType,
} from "@/lib/fsm-types";
import { useCanvasStore } from "@/stores/canvas-store";
import { DslPreviewDialog } from "./dsl-preview-dialog";

const PRIMITIVES: {
  type: FSMStateType;
  label: string;
  desc: string;
  Icon: typeof Play;
}[] = [
  { type: "START", label: "Start", desc: "Entry · State 0 hydration", Icon: Play },
  { type: "SCRIPT", label: "Script", desc: "Deterministic native tool", Icon: SquareTerminal },
  { type: "AI", label: "AI", desc: "LLM reasoning state", Icon: Brain },
  { type: "SPAWN", label: "Spawn", desc: "Fan-out subagents", Icon: GitBranch },
  { type: "AGGREGATE", label: "Aggregate", desc: "Merge child results", Icon: Merge },
  { type: "SYSTEM_FUNCTION", label: "Sys Func", desc: "Checkpoint boundary", Icon: Layers },
  { type: "END", label: "End", desc: "Terminal state", Icon: Flag },
];

/** Labeled state palette (left) + signal-style picker (top center) */
export function CanvasToolbar({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const addNode = useCanvasStore((s) => s.addNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const preferredSignal = useCanvasStore((s) => s.preferredSignal);
  const setPreferredSignal = useCanvasStore((s) => s.setPreferredSignal);
  const { screenToFlowPosition } = useReactFlow();

  const handleAdd = (type: FSMStateType, label: string) => {
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const jitter = () => (Math.random() - 0.5) * 160;
    const id = addNode(
      projectId,
      type,
      { x: center.x + jitter(), y: center.y + jitter() },
      label
    );
    selectNode(id);
  };

  return (
    <>
      {/* State palette — every node type, labeled + color coded (desktop) */}
      <div className="absolute top-4 left-4 z-10 hidden w-[180px] rounded-xl border-2 border-[var(--ink)]/15 bg-[var(--paper)]/90 p-2 shadow-[3px_4px_0_rgba(0,0,0,0.06)] backdrop-blur-sm md:block">
        <span className="mb-1 block px-1.5 pt-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
          Add state
        </span>
        <div className="flex flex-col gap-0.5">
          {PRIMITIVES.map(({ type, label, desc, Icon }) => (
            <button
              key={type}
              onClick={() => handleAdd(type, label)}
              className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-foreground/5"
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 transition-transform group-hover:scale-110",
                  STATE_COLORS[type].note,
                  STATE_COLORS[type].border,
                  STATE_COLORS[type].text
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-foreground">
                  {label}
                </span>
                <span className="block truncate text-[9px] text-muted-foreground">
                  {desc}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* State palette — horizontal icon bar (mobile) */}
      <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-1 rounded-xl border-2 border-[var(--ink)]/15 bg-[var(--paper)]/90 p-1.5 shadow-[3px_4px_0_rgba(0,0,0,0.06)] backdrop-blur-sm md:hidden">
        {PRIMITIVES.map(({ type, label, Icon }) => (
          <button
            key={type}
            title={`Add ${label} state`}
            onClick={() => handleAdd(type, label)}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-md border-2",
              STATE_COLORS[type].note,
              STATE_COLORS[type].border,
              STATE_COLORS[type].text
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      {/* Signal style for new connections + DSL preview */}
      <div className="absolute top-4 left-1/2 z-10 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border-2 border-[var(--ink)]/15 bg-[var(--paper)]/90 p-2 shadow-[3px_4px_0_rgba(0,0,0,0.06)] backdrop-blur-sm">
        <Spline className="ml-1 hidden h-4 w-4 text-[var(--ink)] sm:block" />
        <span className="hidden text-[10px] font-semibold tracking-widest text-muted-foreground uppercase sm:block">
          New wires
        </span>
        <Select
          value={preferredSignal}
          onValueChange={(v) => v && setPreferredSignal(v)}
        >
          <SelectTrigger className="h-8 w-[150px] border-foreground/10 bg-foreground/5 font-mono text-xs sm:w-[190px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-foreground/10 bg-popover text-popover-foreground">
            <SelectItem value="auto" className="font-mono text-xs">
              auto (from source)
            </SelectItem>
            {SIGNAL_PRESETS.map(({ signal }) => (
              <SelectItem key={signal} value={signal} className="font-mono text-xs">
                {signal}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mx-1 h-5 w-px bg-foreground/10" />
        <DslPreviewDialog projectId={projectId} projectName={projectName} />
      </div>
    </>
  );
}
