"use client";

import { useReactFlow } from "@xyflow/react";
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
  PALETTE_GROUPS,
  SIGNAL_PRESETS,
  STATE_CATALOG,
  STATE_COLORS,
  type FSMStateType,
} from "@/lib/fsm-types";
import { useCanvasStore } from "@/stores/canvas-store";
import { DslPreviewDialog } from "./dsl-preview-dialog";

const ICONS: Record<FSMStateType, typeof Play> = {
  START: Play,
  SCRIPT: SquareTerminal,
  HTTP: Globe,
  AI: Brain,
  EXTERNAL_AI: Cloud,
  VALIDATE: ShieldCheck,
  SPAWN: GitBranch,
  AGGREGATE: Merge,
  SYSTEM_FUNCTION: Layers,
  END: Flag,
};

/** Grouped state palette (Flow / Work / Control) + signal-style picker */
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

  const handleAdd = (type: FSMStateType) => {
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const jitter = () => (Math.random() - 0.5) * 160;
    const id = addNode(
      projectId,
      type,
      { x: center.x + jitter(), y: center.y + jitter() },
      STATE_CATALOG[type].label
    );
    selectNode(id);
  };

  return (
    <>
      <div className="absolute top-4 left-4 z-10 hidden w-[200px] rounded-xl border-2 border-[var(--ink)]/15 bg-[var(--paper)]/90 p-2 shadow-[3px_4px_0_rgba(0,0,0,0.06)] backdrop-blur-sm md:block">
        <span className="mb-1 block px-1.5 pt-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
          Add state
        </span>
        <div className="flex flex-col gap-2" data-testid="palette-groups">
          {PALETTE_GROUPS.map((group) => (
            <div key={group.id} data-testid={`palette-group-${group.id}`}>
              <span className="mb-0.5 block px-1.5 text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
                {group.label}
              </span>
              <div className="flex flex-col gap-0.5">
                {group.types.map((type) => {
                  const Icon = ICONS[type];
                  const meta = STATE_CATALOG[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      title={meta.tooltip}
                      onClick={() => handleAdd(type)}
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
                          {meta.label}
                        </span>
                        <span className="block truncate text-[9px] text-muted-foreground">
                          {meta.tooltip}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-4 left-1/2 z-10 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap justify-center gap-1 rounded-xl border-2 border-[var(--ink)]/15 bg-[var(--paper)]/90 p-1.5 shadow-[3px_4px_0_rgba(0,0,0,0.06)] backdrop-blur-sm md:hidden">
        {PALETTE_GROUPS.flatMap((g) => g.types).map((type) => {
          const Icon = ICONS[type];
          return (
            <button
              key={type}
              title={STATE_CATALOG[type].tooltip}
              type="button"
              onClick={() => handleAdd(type)}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md border-2",
                STATE_COLORS[type].note,
                STATE_COLORS[type].border,
                STATE_COLORS[type].text
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>

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
