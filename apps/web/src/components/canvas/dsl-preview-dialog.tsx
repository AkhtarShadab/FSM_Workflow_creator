"use client";

import { useMemo, useState } from "react";
import { Check, Copy, FileJson } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { canvasToDsl, lintCanvas } from "@/lib/canvas-to-dsl";
import { useCanvasStore } from "@/stores/canvas-store";
import { useCredentialStore } from "@/stores/credential-store";
import { useRegistryStore } from "@/stores/registry-store";
import { cn } from "@/lib/utils";

/** View DSL — renders canvasToDsl() output (pure fn §10.2) */
export function DslPreviewDialog({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const nodes = useCanvasStore((s) => s.canvases[projectId]?.nodes);
  const edges = useCanvasStore((s) => s.canvases[projectId]?.edges);
  const credentials = useCredentialStore((s) => s.credentials);
  const registry = useRegistryStore((s) => s.registry);
  const [copied, setCopied] = useState(false);

  const { dsl, issues } = useMemo(() => {
    const canvas = { nodes: nodes ?? [], edges: edges ?? [] };
    return {
      dsl: canvasToDsl(canvas, { name: projectName, registry }),
      issues: lintCanvas(canvas, {
        registry,
        credentials: credentials.map((c) => ({
          id: c.id,
          active: c.active,
          models: c.models,
        })),
      }),
    };
  }, [nodes, edges, projectName, credentials, registry]);

  const json = JSON.stringify(dsl, null, 2);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const copy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog>
      <DialogTrigger className="inline-flex items-center justify-center gap-2 rounded-md border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-foreground/10 hover:text-white">
        <FileJson className="h-4 w-4" />
        View DSL
      </DialogTrigger>
      <DialogContent className="max-w-2xl border-foreground/10 bg-background text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>FSM Definition DSL (v{dsl.version})</span>
            <Button variant="ghost" size="sm" onClick={copy} className="gap-1.5">
              {copied ? (
                <Check className="h-4 w-4 text-emerald-400" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </DialogTitle>
        </DialogHeader>
        {issues.length > 0 && (
          <div
            className="space-y-2 rounded-lg border border-foreground/10 bg-foreground/5 p-3 text-xs"
            data-testid="dsl-lint-panel"
          >
            <p className="font-semibold text-foreground">Linter (E4)</p>
            <ul className="space-y-1">
              {issues.map((i) => (
                <li
                  key={`${i.code}-${i.nodeId ?? ""}-${i.message}`}
                  className="flex items-start gap-2"
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
                        ? "text-red-300"
                        : "text-amber-200/90"
                    }
                  >
                    <span className="font-mono text-[10px] opacity-70">
                      {i.code}
                    </span>{" "}
                    {i.message}
                  </span>
                </li>
              ))}
            </ul>
            {(errors.length > 0 || warnings.length > 0) && (
              <p className="text-[10px] text-muted-foreground">
                {errors.length} error(s), {warnings.length} warning(s)
              </p>
            )}
          </div>
        )}
        <ScrollArea className="h-[50vh] rounded-lg border border-foreground/10 bg-muted">
          <pre className="p-4 font-mono text-xs leading-relaxed text-foreground/80">
            {json}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
