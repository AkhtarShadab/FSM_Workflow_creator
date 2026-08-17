"use client";

import { useMemo, useState } from "react";
import { Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  type EdgeKind,
  type TransitionEdge,
} from "@/lib/fsm-types";
import { groupedSignalPresets } from "@/lib/registry";
import { useCanvasStore } from "@/stores/canvas-store";
import { useRegistryStore } from "@/stores/registry-store";

const KIND_STYLES: Record<EdgeKind, { badge: string; label: string }> = {
  script: {
    badge: "border-sky-400/40 bg-sky-400/10 text-sky-300",
    label: "Bold solid · neon blue",
  },
  ai: {
    badge: "border-purple-400/40 bg-purple-400/10 text-purple-300",
    label: "Dashed · neon purple",
  },
  system: {
    badge: "border-rose-400/40 bg-rose-400/10 text-rose-300",
    label: "Dotted · neon rose",
  },
  spawn: {
    badge: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    label: "Dash-dot · neon amber",
  },
};

const EMPTY_EDGES: TransitionEdge[] = [];
const EMPTY_NODES: import("@/lib/fsm-types").StateNode[] = [];

/** Edge inspector — click any edge to re-route its signal (§6.1 grammar) */
export function EdgeInspectorPanel({ projectId }: { projectId: string }) {
  const selectedEdgeId = useCanvasStore((s) => s.selectedEdgeId);
  const edges = useCanvasStore((s) => s.canvases[projectId]?.edges) ?? EMPTY_EDGES;
  const nodes = useCanvasStore((s) => s.canvases[projectId]?.nodes) ?? EMPTY_NODES;
  const selectEdge = useCanvasStore((s) => s.selectEdge);
  const updateEdgeSignal = useCanvasStore((s) => s.updateEdgeSignal);
  const removeEdge = useCanvasStore((s) => s.removeEdge);
  const registry = useRegistryStore((s) => s.registry);

  const edge = edges.find((e) => e.id === selectedEdgeId);
  const [custom, setCustom] = useState("");

  const presetGroups = useMemo(
    () => groupedSignalPresets(registry),
    [registry]
  );

  if (!edge) return null;

  const source = nodes.find((n) => n.id === edge.source);
  const target = nodes.find((n) => n.id === edge.target);
  const currentSignal = String(edge.data?.signal ?? "");
  const currentKind = (edge.type ?? "script") as EdgeKind;
  const topologyKind = edge.data?.kind ?? "transition";
  const updateEdgeData = useCanvasStore((s) => s.updateEdgeData);

  return (
    <aside className="absolute top-4 right-4 bottom-4 z-20 w-[min(380px,92vw)]">
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-background/90 backdrop-blur-md">
        <div className="flex items-center justify-between gap-2 p-4 pb-3">
          <Badge
            variant="outline"
            className={cn("font-mono text-[10px] tracking-widest", KIND_STYLES[currentKind].badge)}
          >
            {String(topologyKind).toUpperCase()}
          </Badge>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:bg-red-400/10 hover:text-red-300"
              onClick={() => removeEdge(projectId, edge.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => selectEdge(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="px-4 pb-3">
          <p className="text-sm font-semibold text-foreground">
            {source?.data.label ?? edge.source}
            <span className="mx-2 text-muted-foreground">→</span>
            {target?.data.label ?? edge.target}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Style: {KIND_STYLES[currentKind].label}
          </p>
        </div>

        <Separator className="bg-foreground/10" />

        <ScrollArea className="flex-1">
          <div className="space-y-4 p-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                Signal (§6.1)
              </h3>
              {topologyKind === "router" ? (
                <p className="mb-2 text-[10px] text-muted-foreground">
                  Router edges are structural wiring — edit SYS_FUNC heads for
                  topology; signal still labels the wire.
                </p>
              ) : null}
              {topologyKind === "self-loop" ? (
                <div className="mb-3 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Max iterations
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    value={edge.data?.maxIterations ?? 3}
                    onChange={(e) =>
                      updateEdgeData(projectId, edge.id, {
                        maxIterations: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="h-9 border-foreground/10 bg-foreground/5 text-xs"
                    data-testid="self-loop-max-iter"
                  />
                </div>
              ) : null}
              <div className="space-y-3" data-testid="edge-signal-presets">
                {presetGroups.map((group) => (
                  <div key={group.namespace}>
                    <p className="mb-1 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                      {group.namespace}
                    </p>
                    <div className="space-y-1">
                      {group.items.map(({ signal, kind, hint }) => (
                        <button
                          key={signal}
                          type="button"
                          onClick={() =>
                            updateEdgeSignal(projectId, edge.id, signal)
                          }
                          className={cn(
                            "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors",
                            currentSignal === signal
                              ? KIND_STYLES[kind].badge
                              : "border-foreground/10 bg-foreground/5 hover:bg-foreground/10"
                          )}
                          data-testid={`edge-preset-${signal}`}
                        >
                          <span className="font-mono text-xs">{signal}</span>
                          <span className="ml-2 text-[10px] text-muted-foreground">
                            {hint}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                Custom signal (Q5)
              </h3>
              <div className="flex gap-2">
                <Input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder='::MYAPP.DONE|count=3'
                  className="h-9 border-foreground/10 bg-foreground/5 font-mono text-xs"
                />
                <Button
                  size="sm"
                  disabled={!custom.startsWith("::")}
                  onClick={() => updateEdgeSignal(projectId, edge.id, custom)}
                  className="bg-foreground/10 text-foreground hover:bg-foreground/20"
                >
                  Apply
                </Button>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Must start with <code>::</code> — custom namespaces route through
                the bold pencil style.
              </p>
            </div>
          </div>
        </ScrollArea>
      </div>
    </aside>
  );
}
