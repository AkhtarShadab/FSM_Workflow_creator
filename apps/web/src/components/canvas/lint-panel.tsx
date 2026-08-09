"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { lintCanvas } from "@/lib/canvas-to-dsl";
import { useCanvasStore } from "@/stores/canvas-store";
import { useCredentialStore } from "@/stores/credential-store";
import { useRegistryStore } from "@/stores/registry-store";
import { cn } from "@/lib/utils";

/** Compact severity-aware lint strip for the canvas (FeatureShipping 001 C2+) */
export function LintPanel({ projectId }: { projectId: string }) {
  const nodes = useCanvasStore((s) => s.canvases[projectId]?.nodes);
  const edges = useCanvasStore((s) => s.canvases[projectId]?.edges);
  const credentials = useCredentialStore((s) => s.credentials);
  const registry = useRegistryStore((s) => s.registry);
  const [open, setOpen] = useState(false);

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

  if (issues.length === 0) return null;

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div
      className="absolute right-4 bottom-4 z-10 w-[min(340px,calc(100vw-2rem))]"
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
                className="flex items-start gap-2"
                data-testid={`lint-issue-${i.code}`}
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
                    i.severity === "error" ? "text-red-300" : "text-amber-200/90"
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
