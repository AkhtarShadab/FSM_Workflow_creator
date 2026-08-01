"use client";

import { useMemo, useState } from "react";
import { Check, Copy, FileJson } from "lucide-react";
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
  const [copied, setCopied] = useState(false);

  const { dsl, warnings } = useMemo(() => {
    const canvas = { nodes: nodes ?? [], edges: edges ?? [] };
    return {
      dsl: canvasToDsl(canvas, { name: projectName }),
      warnings: lintCanvas(canvas),
    };
  }, [nodes, edges, projectName]);

  const json = JSON.stringify(dsl, null, 2);

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
        {warnings.length > 0 && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-300">
            <p className="mb-1 font-semibold">Linter warnings (E4)</p>
            <ul className="list-inside list-disc space-y-0.5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
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
