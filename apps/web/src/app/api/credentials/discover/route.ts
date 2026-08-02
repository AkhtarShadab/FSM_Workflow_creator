import { NextResponse } from "next/server";
import {
  discoverModels,
  type DiscoveryProvider,
} from "@/lib/model-discovery";

/**
 * Discover models for a BYOK credential.
 * Body: { id?, provider, baseUrl, apiKey }
 * Keys arrive from the client stub store (server AES storage is §14).
 */
export async function POST(request: Request) {
  let body: {
    id?: string;
    provider?: string;
    baseUrl?: string;
    apiKey?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const provider = body.provider as DiscoveryProvider | undefined;
  if (
    !provider ||
    !["openai", "anthropic", "openai-compatible"].includes(provider)
  ) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }
  if (!body.baseUrl || !body.apiKey) {
    return NextResponse.json(
      { error: "baseUrl and apiKey required" },
      { status: 400 }
    );
  }

  const result = await discoverModels({
    provider,
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, id: body.id, error: result.error },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    id: body.id,
    models: result.models.map((m) => m.modelId),
    discoveredAt: Date.now(),
  });
}
