"use client";

import dynamic from "next/dynamic";
import type { Project } from "@/db/schema";

/** Client-only canvas (zustand persist hydrates after mount — no SSR) */
const CanvasView = dynamic(
  () => import("./canvas-view").then((m) => m.CanvasView),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading canvas…
      </div>
    ),
  }
);

export function CanvasViewLoader({ project }: { project: Project }) {
  return <CanvasView project={project} />;
}
