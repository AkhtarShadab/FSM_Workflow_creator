import { lookup } from "node:dns/promises";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { credentials } from "@/db/schema";
import {
  CredentialNotFoundError,
  CredentialRevokedError,
} from "@/lib/credentials/errors";
import { getDecryptedKey } from "@/lib/credentials/server";
import { asCredentialProvider } from "@/lib/credentials/types";
import {
  discoverModels,
  type DiscoveryProvider,
} from "@/lib/model-discovery";
import { isPrivateAddress, validatePublicHttpUrl } from "@/lib/url-guard";

const DEFAULT_BASE_URL: Record<DiscoveryProvider, string | null> = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  "openai-compatible": null,
};

/**
 * Discover models for a stored BYOK credential.
 * Body: { credentialId } only — the key is loaded and opened server-side.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body && "apiKey" in body) {
    return NextResponse.json(
      { error: "apiKey is not accepted; pass credentialId only" },
      { status: 400 }
    );
  }

  const keys = Object.keys(body ?? {});
  if (keys.length !== 1 || keys[0] !== "credentialId") {
    return NextResponse.json(
      { error: "Body must be { credentialId } only" },
      { status: 400 }
    );
  }

  const credentialId = Number(body.credentialId);
  if (!Number.isInteger(credentialId) || credentialId < 1) {
    return NextResponse.json({ error: "Invalid credentialId" }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: credentials.id,
      provider: credentials.provider,
      baseUrl: credentials.baseUrl,
      revokedAt: credentials.revokedAt,
    })
    .from(credentials)
    .where(eq(credentials.id, credentialId))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  }
  if (row.revokedAt != null) {
    return NextResponse.json(
      { error: "CREDENTIAL_REVOKED", code: "CREDENTIAL_REVOKED" },
      { status: 409 }
    );
  }

  let provider: DiscoveryProvider;
  try {
    provider = asCredentialProvider(row.provider);
  } catch {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  const baseUrl = row.baseUrl?.trim() || DEFAULT_BASE_URL[provider];
  if (!baseUrl) {
    return NextResponse.json(
      { error: "baseUrl is required for this provider" },
      { status: 400 }
    );
  }

  const guard = validatePublicHttpUrl(baseUrl);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: 400 });
  }
  try {
    const addresses = await lookup(guard.url.hostname, { all: true });
    if (addresses.some((a) => isPrivateAddress(a.address))) {
      return NextResponse.json(
        { error: "Host resolves to a private or internal address" },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Host could not be resolved" },
      { status: 400 }
    );
  }

  let apiKey: string;
  try {
    apiKey = await getDecryptedKey(credentialId);
  } catch (err) {
    if (err instanceof CredentialNotFoundError) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }
    if (err instanceof CredentialRevokedError) {
      return NextResponse.json(
        { error: "CREDENTIAL_REVOKED", code: "CREDENTIAL_REVOKED" },
        { status: 409 }
      );
    }
    throw err;
  }

  const result = await discoverModels({
    provider,
    baseUrl,
    apiKey,
  });

  const discoveredAt = Date.now();

  if (!result.ok) {
    await db
      .update(credentials)
      .set({
        discoveryStatus: "error",
        discoveryError: result.error,
        discoveredAt: new Date(discoveredAt),
      })
      .where(eq(credentials.id, credentialId));
    return NextResponse.json(
      { ok: false, credentialId, error: result.error },
      { status: 502 }
    );
  }

  const models = result.models.map((m) => m.modelId);
  await db
    .update(credentials)
    .set({
      modelsJson: JSON.stringify(models),
      discoveryStatus: "ok",
      discoveryError: null,
      discoveredAt: new Date(discoveredAt),
    })
    .where(eq(credentials.id, credentialId));

  return NextResponse.json({
    ok: true,
    credentialId,
    models,
    discoveredAt,
  });
}
