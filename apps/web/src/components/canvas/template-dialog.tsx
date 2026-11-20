"use client";

import { useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { WORKFLOW_TEMPLATES } from "@/lib/templates";
import { applyTemplate } from "@/lib/templates/apply";
import { useCanvasStore } from "@/stores/canvas-store";
import { canvasFitOptions } from "./fit-padding";

/** Start a board from a ready-made workflow (e.g. the water-inspection demo). */
export function TemplateDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const hasNodes = useCanvasStore(
    (s) => (s.canvases[projectId]?.nodes.length ?? 0) > 0
  );
  const { fitView } = useReactFlow();

  const load = (id: string) => {
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    if (
      hasNodes &&
      !window.confirm("Replace the current board with this template? This cannot be undone.")
    ) {
      return;
    }
    applyTemplate(projectId, template);
    setOpen(false);
    // let React Flow measure the new nodes before framing them
    setTimeout(() => void fitView(canvasFitOptions(400)), 80);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="inline-flex items-center justify-center gap-2 rounded-md border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-foreground/10"
        data-testid="open-templates"
        title="Templates"
        aria-label="Templates"
      >
        <LayoutTemplate className="h-4 w-4" />
        <span className="hidden xl:inline">Templates</span>
      </DialogTrigger>
      <DialogContent className="max-w-lg border-foreground/10 bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>Start from a template</DialogTitle>
        </DialogHeader>
        <ul className="space-y-3">
          {WORKFLOW_TEMPLATES.map((t) => (
            <li
              key={t.id}
              className="rounded-lg border border-foreground/10 bg-foreground/5 p-3"
            >
              <p className="text-sm font-semibold">{t.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.summary}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {t.build().nodes.length} states · {t.scenarios.length} run scenarios
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => load(t.id)}
                data-testid={`load-template-${t.id}`}
              >
                Load template
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
