"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { indexWorkspacePath } from "@/app/code-index/actions";
import { db } from "@/db";
import { codeSymbols, memoryEdges, memoryNodes } from "@/db/schema";
import {
  buildMemoryBook,
  type MemoryBook,
} from "@/lib/memory/book-toc";
import type { IndexPathError, IndexPathResult } from "@/lib/code-index/types";

const SAMPLE_FIXTURE = "apps/web/fixtures/code-index-sample";

export async function getMemoryBook(projectId: number): Promise<MemoryBook> {
  const rows = await db
    .select({
      filePath: codeSymbols.filePath,
      identity: codeSymbols.identity,
      intent: codeSymbols.intent,
      kind: codeSymbols.kind,
      startLine: codeSymbols.startLine,
    })
    .from(codeSymbols)
    .where(eq(codeSymbols.projectId, projectId));

  return buildMemoryBook(rows);
}

export async function indexMemoryFixture(
  projectId: number
): Promise<IndexPathResult | IndexPathError> {
  const result = await indexWorkspacePath(projectId, SAMPLE_FIXTURE);
  revalidatePath("/memory");
  return result;
}

export async function addMemoryNode(input: {
  label: string;
  kind: "fact" | "artifact" | "preference" | "checkpoint_ref";
  content: string;
  projectId?: number;
}): Promise<void> {
  await db.insert(memoryNodes).values({
    label: input.label.trim() || "Untitled memory",
    kind: input.kind,
    content: input.content,
    projectId: input.projectId ?? null,
  });
  revalidatePath("/memory");
}

export async function addMemoryEdge(input: {
  sourceId: number;
  targetId: number;
  relation: "derived_from" | "summarizes" | "prefers" | "references";
  projectId?: number;
}): Promise<void> {
  if (input.sourceId === input.targetId) return;
  await db.insert(memoryEdges).values({
    sourceId: input.sourceId,
    targetId: input.targetId,
    relation: input.relation,
    projectId: input.projectId ?? null,
  });
  revalidatePath("/memory");
}

export async function seedMemoryGraph(): Promise<void> {
  const inserted = await db
    .insert(memoryNodes)
    .values([
      { label: "User prefers concise summaries", kind: "preference", content: "Keep summaries under 120 words; bullet points over prose." },
      { label: "Pages scraped: 12", kind: "fact", content: "Source crawl returned 12 pages from docs site." },
      { label: "Summary v1", kind: "artifact", content: "First LLM summary of the crawl batch." },
      { label: "cp_9f2 dehydration", kind: "checkpoint_ref", content: "Checkpoint cp_9f2 holds raw cluster context." },
      { label: "Summary v2 (final)", kind: "artifact", content: "Condensed final summary using preference node." },
      { label: "Token budget: 200k", kind: "preference", content: "Per-run budget configured in fsm.json." },
    ])
    .returning({ id: memoryNodes.id });

  const [pref, pages, v1, cp, v2, budget] = inserted.map((r) => r.id);
  await db.insert(memoryEdges).values([
    { sourceId: v1, targetId: pages, relation: "summarizes" },
    { sourceId: v1, targetId: cp, relation: "derived_from" },
    { sourceId: v2, targetId: v1, relation: "derived_from" },
    { sourceId: v2, targetId: pref, relation: "prefers" },
    { sourceId: cp, targetId: pages, relation: "references" },
    { sourceId: v1, targetId: budget, relation: "references" },
  ]);
  revalidatePath("/memory");
}
