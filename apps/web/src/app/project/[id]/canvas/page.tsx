import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { CanvasViewLoader } from "@/components/canvas/canvas-view-loader";
import { db } from "@/db";
import { projects } from "@/db/schema";

export default async function ProjectCanvasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const projectId = Number(id);
  if (Number.isNaN(projectId)) notFound();

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) notFound();

  return <CanvasViewLoader project={project} />;
}
