"use client";

import { useState } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { ReactFlowProvider } from "@xyflow/react";
import { CopilotPanel } from "@/components/copilot/copilot-panel";
import { FsmCanvas } from "@/components/canvas/fsm-canvas";
import { DescribePanel } from "@/components/canvas/describe-panel";
import { EdgeInspectorPanel } from "@/components/canvas/edge-inspector";
import { InspectorPanel } from "@/components/inspector/inspector-panel";
import { ProjectNav } from "@/components/nav/project-nav";
import type { Project } from "@/db/schema";

export function CanvasView({ project }: { project: Project }) {
  const projectId = String(project.id);
  // Only greet with the Describe sheet on an empty board — re-opening it on
  // every visit covered the canvas and had to be dismissed each time.
  const [describeOpen, setDescribeOpen] = useState(
    () => (useCanvasStore.getState().canvases[projectId]?.nodes.length ?? 0) === 0
  );

  return (
    <div className="flex h-dvh flex-col bg-background">
      <ProjectNav
        projectId={projectId}
        projectName={project.name}
        onDescribe={() => setDescribeOpen(true)}
      />
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <ReactFlowProvider>
          <FsmCanvas projectId={projectId} projectName={project.name} />
          <InspectorPanel projectId={projectId} />
          <EdgeInspectorPanel projectId={projectId} />
          <CopilotPanel projectId={projectId} />
          {describeOpen && (
            <DescribePanel
              project={project}
              onClose={() => setDescribeOpen(false)}
            />
          )}
        </ReactFlowProvider>
      </main>
    </div>
  );
}
