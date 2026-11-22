import type { CanvasData } from "@/lib/fsm-types";
import { waterInspectionTemplate } from "./water-inspection";
import type { WorkflowTemplate } from "./types";

export type { RunScenario, SignalOverrides, WorkflowTemplate } from "./types";

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [waterInspectionTemplate];

export function getTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}

/**
 * Which template (if any) a canvas was built from — detected by its fixed
 * state ids, so nothing extra has to be persisted with the canvas.
 */
export function detectTemplate(canvas: CanvasData | undefined): WorkflowTemplate | undefined {
  if (!canvas || canvas.nodes.length === 0) return undefined;
  const ids = new Set(canvas.nodes.map((n) => n.id));
  return WORKFLOW_TEMPLATES.find((t) =>
    t.build().nodes.every((n) => ids.has(n.id))
  );
}
