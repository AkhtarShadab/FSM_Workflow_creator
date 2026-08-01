import { desc } from "drizzle-orm";
import MemoryView from "@/components/memory/memory-view";
import { db } from "@/db";
import { memoryEdges, memoryNodes } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const nodes = await db
    .select()
    .from(memoryNodes)
    .orderBy(desc(memoryNodes.createdAt))
    .limit(60);
  const edges = await db.select().from(memoryEdges).limit(120);

  return <MemoryView nodes={nodes} edges={edges} />;
}
