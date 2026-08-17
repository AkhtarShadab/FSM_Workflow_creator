import {
  getAdapter,
  isMockProviderEnabled,
  isProviderError,
  type ChatMessage,
  type ChatRequest,
  type ProviderAdapter,
  type ProviderId,
} from "@fsm/byok-gateway";
import {
  CredentialNotFoundError,
  CredentialRevokedError,
} from "@/lib/credentials/errors";
import { getDecryptedKey } from "@/lib/credentials/server";
import { db } from "@/db";
import { credentials } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { AIConfig, ExternalAIConfig, StateNodeData } from "@/lib/fsm-types";
import type { Executor, ExecutorContext } from "./types";

export interface CredentialMaterial {
  key: string;
  provider: ProviderId;
  baseUrl: string | null;
}

export interface AiExecutorDeps {
  adapter?: ProviderAdapter;
  isMock?: () => boolean;
  getCredential?: (id: number) => Promise<CredentialMaterial>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const DEFAULT_SLEEP = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });

function successSignal(type: string): string {
  return type === "EXTERNAL_AI" ? "::EXTERNAL_AI.NEXT" : "::AI.NEXT";
}

function errorSignal(type: string): string {
  return type === "EXTERNAL_AI" ? "::EXTERNAL_AI.ERROR" : "::AI.ERROR";
}

function asProviderId(value: string): ProviderId {
  if (
    value === "openai" ||
    value === "anthropic" ||
    value === "openai-compatible" ||
    value === "mock"
  ) {
    return value;
  }
  return "openai";
}

function parseCredentialId(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function messagesFromPayload(payload: unknown): ChatMessage[] {
  if (
    payload &&
    typeof payload === "object" &&
    "messages" in payload &&
    Array.isArray((payload as { messages: unknown }).messages)
  ) {
    return (payload as { messages: ChatMessage[] }).messages.filter(
      (m) => m && typeof m.content === "string" && typeof m.role === "string"
    );
  }
  if (typeof payload === "string") {
    return [{ role: "user", content: payload }];
  }
  return [{ role: "user", content: JSON.stringify(payload ?? {}) }];
}

function parseOutputSchema(raw: string | undefined): object | undefined {
  if (!raw || !raw.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as object;
  } catch {
    /* ignore invalid schema JSON */
  }
  return undefined;
}

function valueMatchesSchema(value: unknown, schema: object): boolean {
  if (!("type" in schema) || typeof (schema as { type?: string }).type !== "string") {
    return true;
  }
  const t = (schema as { type: string }).type;
  if (t === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  if (t === "array") return Array.isArray(value);
  if (t === "string") return typeof value === "string";
  if (t === "number") return typeof value === "number";
  if (t === "boolean") return typeof value === "boolean";
  return true;
}

function parseModelJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function aiConfigFromNode(
  type: string,
  data: StateNodeData | undefined
): {
  credentialId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  outputSchema: string;
} {
  if (type === "EXTERNAL_AI") {
    const e: ExternalAIConfig | undefined = data?.externalAi;
    return {
      credentialId: e?.credentialId ?? "",
      model: e?.model ?? "mock-chat",
      temperature: e?.temperature ?? 0,
      maxTokens: e?.maxTokens ?? 256,
      systemPrompt: e?.systemPrompt ?? "",
      outputSchema: e?.outputSchema ?? "",
    };
  }
  const a: AIConfig | undefined = data?.ai;
  return {
    credentialId: a?.credentialId ?? "",
    model: a?.model ?? "mock-chat",
    temperature: a?.temperature ?? 0,
    maxTokens: a?.maxTokens ?? 256,
    systemPrompt: a?.systemPrompt ?? "",
    outputSchema: a?.outputSchema ?? data?.outputSchema ?? "",
  };
}

async function defaultGetCredential(id: number): Promise<CredentialMaterial> {
  const [row] = await db
    .select({
      provider: credentials.provider,
      baseUrl: credentials.baseUrl,
      revokedAt: credentials.revokedAt,
    })
    .from(credentials)
    .where(eq(credentials.id, id))
    .limit(1);
  if (!row || row.revokedAt != null) {
    throw new CredentialNotFoundError(id);
  }
  const key = await getDecryptedKey(id);
  return {
    key,
    provider: asProviderId(row.provider),
    baseUrl: row.baseUrl,
  };
}

export function createAiExecutor(deps: AiExecutorDeps = {}): Executor {
  const isMock = deps.isMock ?? isMockProviderEnabled;
  const getCredential = deps.getCredential ?? defaultGetCredential;
  const sleep = deps.sleep ?? DEFAULT_SLEEP;

  return async function executeAi(ctx: ExecutorContext) {
    const cfg = aiConfigFromNode(ctx.state.type, ctx.node?.data);
    const ok = successSignal(ctx.state.type);
    const err = errorSignal(ctx.state.type);
    const retryMax = ctx.state.guardrails?.retryMax ?? 0;
    const backoff = ctx.state.guardrails?.retryBackoffMs ?? 0;
    const jsonSchema = parseOutputSchema(cfg.outputSchema);

    let material: CredentialMaterial | null = null;
    if (!isMock()) {
      const credId = parseCredentialId(cfg.credentialId);
      if (credId == null) {
        await ctx.emit({
          stateId: ctx.state.id,
          kind: "state.error",
          payload: { code: "CREDENTIAL_UNAVAILABLE" },
        });
        return err;
      }
      try {
        material = await getCredential(credId);
      } catch (e) {
        if (
          e instanceof CredentialNotFoundError ||
          e instanceof CredentialRevokedError
        ) {
          await ctx.emit({
            stateId: ctx.state.id,
            kind: "state.error",
            payload: { code: "CREDENTIAL_UNAVAILABLE", credentialId: credId },
          });
          return err;
        }
        throw e;
      }
    }

    const adapter =
      deps.adapter ??
      getAdapter(isMock() ? "mock" : (material?.provider ?? "openai"));
    const key = material?.key ?? "mock-key";
    const baseUrl = material?.baseUrl ?? undefined;

    const request: ChatRequest = {
      model: cfg.model,
      systemPrompt: cfg.systemPrompt || undefined,
      messages: messagesFromPayload(ctx.payload),
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
      jsonSchema,
      signal: ctx.signal,
    };

    const maxAttempts = Math.max(1, retryMax + 1);
    let lastError = "PROVIDER_ERROR";
    let resultText = "";
    let tokensIn = 0;
    let tokensOut = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (ctx.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      try {
        const handle = adapter.chat(request, key, baseUrl);
        for await (const chunk of handle) {
          await ctx.emit(
            {
              stateId: ctx.state.id,
              kind: "state.token",
              payload: { delta: chunk.delta },
            },
            { persist: false }
          );
        }
        const result = await handle;
        resultText = result.text;
        tokensIn = result.tokensIn;
        tokensOut = result.tokensOut;

        if (jsonSchema) {
          const parsed = parseModelJson(resultText);
          if (!valueMatchesSchema(parsed, jsonSchema)) {
            await ctx.emit({
              stateId: ctx.state.id,
              kind: "state.retry",
              payload: { reason: "output_schema", attempt },
            });
            const correction = adapter.chat(
              {
                ...request,
                messages: [
                  ...request.messages,
                  { role: "assistant", content: resultText },
                  {
                    role: "user",
                    content: `Your output failed schema validation. Return JSON matching: ${JSON.stringify(jsonSchema)}`,
                  },
                ],
              },
              key,
              baseUrl
            );
            const corrected = await correction;
            resultText = corrected.text;
            tokensIn += corrected.tokensIn;
            tokensOut += corrected.tokensOut;
            const parsed2 = parseModelJson(resultText);
            if (!valueMatchesSchema(parsed2, jsonSchema)) {
              await ctx.emit({
                stateId: ctx.state.id,
                kind: "state.error",
                payload: { code: "OUTPUT_SCHEMA" },
              });
              return err;
            }
          }
        }

        return {
          signal: ok,
          payload: {
            text: resultText,
            tokensIn,
            tokensOut,
          },
        };
      } catch (e) {
        if (
          e instanceof DOMException &&
          (e.name === "AbortError" || ctx.signal.aborted)
        ) {
          throw e;
        }
        if (isProviderError(e) && e.code === "AUTH_FAILED") {
          await ctx.emit({
            stateId: ctx.state.id,
            kind: "state.error",
            payload: { code: "AUTH_FAILED" },
          });
          return err;
        }
        const retryable = isProviderError(e) ? e.retryable : true;
        lastError = isProviderError(e)
          ? e.code
          : e instanceof Error
            ? e.message
            : "PROVIDER_ERROR";
        if (!retryable || attempt >= maxAttempts) {
          await ctx.emit({
            stateId: ctx.state.id,
            kind: "state.error",
            payload: { code: lastError, attempts: attempt },
          });
          return err;
        }
        await ctx.emit({
          stateId: ctx.state.id,
          kind: "state.retry",
          payload: { attempt, code: lastError },
        });
        if (backoff > 0) await sleep(backoff, ctx.signal);
      }
    }

    await ctx.emit({
      stateId: ctx.state.id,
      kind: "state.error",
      payload: { code: lastError },
    });
    return err;
  };
}

export const executeAi: Executor = createAiExecutor();
