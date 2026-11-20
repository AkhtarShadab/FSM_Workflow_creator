"use client";

import { useMemo, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { lintCanvas } from "@/lib/canvas-to-dsl";
import { useCanvasStore, useLogicalNodes } from "@/stores/canvas-store";
import { useCredentialStore } from "@/stores/credential-store";
import { useRegistryStore } from "@/stores/registry-store";
import { cn } from "@/lib/utils";

/** Compact severity-aware lint strip for the canvas (FeatureShipping 001 C2+) */
export function LintPanel({ projectId }: { projectId: string }) {
  const nodes = useLogicalNodes(projectId);
  const edges = useCanvasStore((s) => s.canvases[projectId]?.edges);
  const credentials = useCredentialStore((s) => s.credentials);
  const registry = useRegistryStore((s) => s.registry);
  const [open, setOpen] = useState(false);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const { fitView } = useReactFlow();

  /** Jump to the state an issue is about (select + centre it). */
  const focusNode = (nodeId?: string) => {
    if (!nodeId || !(nodes ?? []).some((n) => n.id === nodeId)) return;
    selectNode(nodeId);
    void fitView({ nodes: [{ id: nodeId }], duration: 300, maxZoom: 1.2 });
  };

  const issues = useMemo(
    () =>
      lintCanvas(
        { nodes: nodes ?? [], edges: edges ?? [] },
        {
          registry,
          credentials: credentials.map((c) => ({
            id: c.id,
            active: c.active,
            models: c.models,
          })),
        }
      ),
    [nodes, edges, credentials, registry]
  );

  if (issues.length === 0) {
    // Say so explicitly — a clean board is worth showing, not hiding.
    return (
      <div
        className="absolute bottom-[7.25rem] left-2 z-10 md:right-36 md:bottom-4 md:left-auto"
        data-testid="canvas-lint-clean"
      >
        <span className="flex items-center gap-1.5 rounded-xl border-2 border-emerald-500/30 bg-[var(--paper)]/95 px-3 py-2 text-xs font-semibold text-emerald-700 shadow-[3px_4px_0_rgba(0,0,0,0.06)] dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" /> Lint clean
        </span>
      </div>
    );
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div
      className="absolute bottom-[7.25rem] left-2 z-10 w-[min(340px,calc(100%-8.5rem))] md:right-36 md:bottom-4 md:left-auto"
      data-testid="canvas-lint-panel"
    >
      <div className="overflow-hidden rounded-xl border-2 border-[var(--ink)]/15 bg-[var(--paper)]/95 shadow-[3px_4px_0_rgba(0,0,0,0.06)] backdrop-blur-sm">
        <Button
          type="button"
          variant="ghost"
          className="flex h-auto w-full items-center justify-between gap-2 rounded-none px-3 py-2 text-left hover:bg-foreground/5"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <AlertTriangle
              className={cn(
                "h-3.5 w-3.5",
                errors.length > 0 ? "text-red-400" : "text-amber-400"
              )}
            />
            Lint
            {errors.length > 0 && (
              <Badge variant="destructive" className="uppercase">
                {errors.length} error
                {errors.length === 1 ? "" : "s"}
              </Badge>
            )}
            {warnings.length > 0 && (
              <Badge
                variant="outline"
                className="border-amber-400/40 text-amber-300 uppercase"
              >
                {warnings.length} warn
              </Badge>
            )}
          </span>
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
        {open && (
          <ul className="max-h-48 space-y-1.5 overflow-y-auto border-t border-foreground/10 px-3 py-2 text-[11px]">
            {issues.map((i) => (
              <li
                key={`${i.code}-${i.nodeId ?? ""}-${i.message}`}
                className={cn(
                  "flex items-start gap-2 rounded px-1 py-0.5",
                  i.nodeId && "cursor-pointer hover:bg-foreground/5"
                )}
                data-testid={`lint-issue-${i.code}`}
                onClick={() => focusNode(i.nodeId)}
                title={i.nodeId ? "Show this state" : undefined}
              >
                <Badge
                  variant={i.severity === "error" ? "destructive" : "outline"}
                  className={cn(
                    "mt-0.5 shrink-0 uppercase",
                    i.severity === "warning" &&
                      "border-amber-400/40 text-amber-300"
                  )}
                >
                  {i.severity}
                </Badge>
                <span
                  className={
                    i.severity === "error"
                      ? "text-red-600 dark:text-red-300"
                      : "text-amber-700 dark:text-amber-200/90"
                  }
                >
                  {i.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
