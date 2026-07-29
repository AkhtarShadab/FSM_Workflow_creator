"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";

export async function createProject(name: string): Promise<number> {
  const trimmed = name.trim() || "Untitled Harness";
  const [row] = await db
    .insert(projects)
    .values({ name: trimmed })
    .returning({ id: projects.id });
  revalidatePath("/");
  return row.id;
}

export async function deleteProject(id: number): Promise<void> {
  // FK ON DELETE CASCADE removes fsm_definitions + credentials (§5.1)
  await db.delete(projects).where(eq(projects.id, id));
  revalidatePath("/");
}

export async function updateProjectDescription(
  id: number,
  description: string
): Promise<void> {
  await db
    .update(projects)
    .set({ description, updatedAt: new Date() })
    .where(eq(projects.id, id));
  revalidatePath(`/project/${id}`);
}
