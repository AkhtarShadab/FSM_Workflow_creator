"use client";

import { useState } from "react";
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
  const [describeOpen, setDescribeOpen] = useState(true);

  return (
    <div className="flex h-screen flex-col bg-background">
      <ProjectNav
        projectId={projectId}
        projectName={project.name}
        onDescribe={() => setDescribeOpen(true)}
      />
      <main className="relative flex-1">
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
