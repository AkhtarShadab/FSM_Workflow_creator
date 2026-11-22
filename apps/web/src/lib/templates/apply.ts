import { useCanvasStore } from "@/stores/canvas-store";
import { useRegistryStore } from "@/stores/registry-store";
import { registerSignal, registerSkill } from "@/lib/registry";
import type { WorkflowTemplate } from "./types";

/**
 * Load a template onto a project's canvas and register the custom signals /
 * skills it relies on, so the board lints clean immediately.
 */
export function applyTemplate(projectId: string, template: WorkflowTemplate) {
  const { registry, setRegistry } = useRegistryStore.getState();
  let next = registry;
  for (const s of template.registry.signals) next = registerSignal(next, s.signal, s.description);
  for (const skill of template.registry.skills) next = registerSkill(next, skill);
  if (next !== registry) setRegistry(next);
  useCanvasStore.getState().loadCanvas(projectId, template.build());
}
