import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { credentials } from "@/db/schema";
import { EnvelopeError, isSealed, open } from "@/lib/crypto/envelope";
import {
  CredentialNotFoundError,
  CredentialRevokedError,
} from "@/lib/credentials/errors";

/**
 * The only allowed `open()` call site. Used by discovery and live executors (003).
 * Errors carry `credentialId` only — never envelope or plaintext.
 */
export async function getDecryptedKey(id: number): Promise<string> {
  const [row] = await db
    .select({
      id: credentials.id,
      encryptedKey: credentials.encryptedKey,
      revokedAt: credentials.revokedAt,
    })
    .from(credentials)
    .where(eq(credentials.id, id))
    .limit(1);

  if (!row) {
    throw new CredentialNotFoundError(id);
  }
  if (row.revokedAt != null || !row.encryptedKey || !isSealed(row.encryptedKey)) {
    throw new CredentialRevokedError(id);
  }

  try {
    return open(row.encryptedKey);
  } catch (err) {
    if (err instanceof EnvelopeError) {
      throw new CredentialRevokedError(id);
    }
    throw err;
  }
}
