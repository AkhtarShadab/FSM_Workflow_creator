"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { credentials } from "@/db/schema";
import { seal } from "@/lib/crypto/envelope";
import {
  CredentialNotFoundError,
  CredentialRevokedError,
} from "@/lib/credentials/errors";
import {
  asCredentialProvider,
  last4Of,
  toCredentialSummary,
  type CredentialProvider,
  type CredentialSummary,
} from "@/lib/credentials/types";

export type { CredentialSummary, CredentialProvider };

function revalidateCredentials(): void {
  revalidatePath("/settings/credentials");
}

export async function createCredential(input: {
  provider: CredentialProvider;
  label: string;
  baseUrl?: string | null;
  apiKey: string;
  projectId?: number | null;
}): Promise<CredentialSummary> {
  const provider = asCredentialProvider(input.provider);
  const apiKey = input.apiKey;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error("apiKey is required");
  }
  const label = input.label.trim() || `${provider} key`;
  const baseUrl = input.baseUrl?.trim() ? input.baseUrl.trim() : null;
  const encryptedKey = seal(apiKey);
  const last4 = last4Of(apiKey);

  const [row] = await db
    .insert(credentials)
    .values({
      projectId: input.projectId ?? null,
      provider,
      label,
      baseUrl,
      encryptedKey,
      last4,
      active: true,
      discoveryStatus: "idle",
    })
    .returning();

  if (!row) throw new Error("Failed to create credential");
  revalidateCredentials();
  return toCredentialSummary(row);
}

export async function listCredentials(): Promise<CredentialSummary[]> {
  const rows = await db
    .select()
    .from(credentials)
    .orderBy(desc(credentials.createdAt), desc(credentials.id));
  return rows.map((row) => toCredentialSummary(row));
}

export async function rotateCredential(
  id: number,
  newApiKey: string
): Promise<CredentialSummary> {
  if (typeof newApiKey !== "string" || newApiKey.length === 0) {
    throw new Error("apiKey is required");
  }

  const [existing] = await db
    .select({
      id: credentials.id,
      revokedAt: credentials.revokedAt,
    })
    .from(credentials)
    .where(eq(credentials.id, id))
    .limit(1);

  if (!existing) throw new CredentialNotFoundError(id);
  if (existing.revokedAt != null) throw new CredentialRevokedError(id);

  const [row] = await db
    .update(credentials)
    .set({
      encryptedKey: seal(newApiKey),
      last4: last4Of(newApiKey),
    })
    .where(eq(credentials.id, id))
    .returning();

  if (!row) throw new CredentialNotFoundError(id);
  revalidateCredentials();
  return toCredentialSummary(row);
}

export async function revokeCredential(id: number): Promise<CredentialSummary> {
  const [existing] = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(eq(credentials.id, id))
    .limit(1);

  if (!existing) throw new CredentialNotFoundError(id);

  const [row] = await db
    .update(credentials)
    .set({
      encryptedKey: "",
      revokedAt: new Date(),
      active: false,
    })
    .where(eq(credentials.id, id))
    .returning();

  if (!row) throw new CredentialNotFoundError(id);
  revalidateCredentials();
  return toCredentialSummary(row);
}
