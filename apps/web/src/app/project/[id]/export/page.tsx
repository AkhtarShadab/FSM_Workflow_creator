import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ExportWizard } from "@/components/export/export-wizard";
import { db } from "@/db";
import { projects } from "@/db/schema";

export default async function ProjectExportPage({
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

  return <ExportWizard projectId={id} projectName={project.name} />;
}
