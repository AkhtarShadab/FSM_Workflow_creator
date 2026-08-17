import { asc, desc } from "drizzle-orm";
import { getMemoryBook } from "@/app/memory/actions";
import MemoryView from "@/components/memory/memory-view";
import { db } from "@/db";
import { memoryEdges, memoryNodes, projects } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const nodes = await db
    .select()
    .from(memoryNodes)
    .orderBy(desc(memoryNodes.createdAt))
    .limit(60);
  const edges = await db.select().from(memoryEdges).limit(120);
  const [firstProject] = await db
    .select({ id: projects.id })
    .from(projects)
    .orderBy(asc(projects.id))
    .limit(1);
  const projectId = firstProject?.id ?? 1;
  const book = await getMemoryBook(projectId);

  return (
    <MemoryView
      nodes={nodes}
      edges={edges}
      book={book}
      projectId={projectId}
    />
  );
}
