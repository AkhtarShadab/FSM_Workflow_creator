import { asc } from "drizzle-orm";
import { CodeIndexPanel } from "@/components/code-index/code-index-panel";
import { db } from "@/db";
import { projects } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function CodeIndexPage() {
  const [firstProject] = await db
    .select({ id: projects.id })
    .from(projects)
    .orderBy(asc(projects.id))
    .limit(1);

  const defaultProjectId = firstProject?.id ?? 1;

  return <CodeIndexPanel defaultProjectId={defaultProjectId} />;
}
