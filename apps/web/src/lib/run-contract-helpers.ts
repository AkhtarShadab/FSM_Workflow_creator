import type { EngineEdge, EngineState, RetryReason } from "@fsm/engine";
import {
  defaultNodeData,
  type FSMStateType,
  type StateNodeData,
} from "@/lib/fsm-types";
import type { SuccessCondition } from "@/lib/verify-success";
import type { ToolAccess } from "@/lib/tool-grants";

const SUCCESS_BY_TYPE: Record<string, string> = {
  HTTP: "::HTTP.NEXT",
  VALIDATE: "::VALIDATE.NEXT",
  AI: "::AI.NEXT",
  EXTERNAL_AI: "::EXTERNAL_AI.NEXT",
  HUMAN: "::HUMAN.APPROVE",
  SYSTEM_FUNCTION: "::SYSTEM.HYDRATE",
  SPAWN: "::SPAWN.SUBAGENTS",
};

export function defaultSuccessSignal(stateType: string): string {
  return SUCCESS_BY_TYPE[stateType] ?? "::SCRIPT.NEXT";
}

export function readSuccessCondition(
  data: StateNodeData | undefined
): SuccessCondition {
  const raw = (data as Record<string, unknown> | undefined)?.successCondition;
  if (raw && typeof raw === "object" && "kind" in raw) {
    return raw as SuccessCondition;
  }
  return { kind: "signal" };
}

export function readToolAccess(data: StateNodeData | undefined): ToolAccess {
  const raw = (data as Record<string, unknown> | undefined)?.toolAccess;
  if (
    raw &&
    typeof raw === "object" &&
    "mode" in raw &&
    typeof (raw as ToolAccess).mode === "string"
  ) {
    return raw as ToolAccess;
  }
  return { mode: "inherit", allow: [] };
}

export function readRetainContext(data: StateNodeData | undefined): boolean {
  return Boolean((data as Record<string, unknown> | undefined)?.retainContext);
}

export function inheritToolsForState(
  data: StateNodeData | undefined,
  stateType: string
): string[] {
  const tools: string[] = [];
  if (stateType === "SCRIPT" && data?.script?.toolName) {
    tools.push(data.script.toolName);
  }
  if (stateType === "HTTP") {
    tools.push("http");
    if (data?.label) tools.push(`http:${data.label}`);
  }
  return tools;
}

export function outgoingSignalsForState(
  stateId: string,
  edges: EngineEdge[]
): string[] {
  return edges.filter((e) => e.from === stateId).map((e) => e.on);
}

const CURSOR_PAYLOAD_MAX = 64 * 1024;

export function payloadToRef(payload: unknown): string {
  const json = JSON.stringify(payload ?? {});
  if (json.length <= CURSOR_PAYLOAD_MAX) return json;
  return `${json.slice(0, CURSOR_PAYLOAD_MAX)}…CURSOR_PAYLOAD_TRUNCATED`;
}

export function parsePayloadRef(ref: string): unknown {
  try {
    return JSON.parse(ref) as unknown;
  } catch {
    return ref;
  }
}

interface DslState {
  id: string;
  type: string;
  label?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  onError?: { signal?: string };
  transitions?: Array<{
    on: string;
    to: string;
    kind?: string;
    maxIterations?: number;
  }>;
  tool?: {
    name?: string;
    language?: string;
    timeoutMs?: number;
    retry?: { max?: number; backoffMs?: number };
  };
  human?: { prompt?: string; approvalSignals?: string[]; timeoutMs?: number };
  llm?: {
    credentialId?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
    outputSchema?: unknown;
  };
  http?: {
    method?: string;
    urlTemplate?: string;
    headers?: Record<string, string>;
    bodyTemplate?: string;
    successSignals?: string[];
    authCredentialId?: string;
  };
  validate?: { kind?: string; schema?: unknown };
  successCondition?: SuccessCondition;
  toolAccess?: ToolAccess;
  retainContext?: boolean;
  guardrails?: { retryOn?: string[] };
}

interface DslDocument {
  states?: DslState[];
}

export function dslToEngine(dslJson: string): {
  states: EngineState[];
  edges: EngineEdge[];
} {
  const doc = JSON.parse(dslJson) as DslDocument;
  const dslStates = doc.states ?? [];
  const states: EngineState[] = dslStates.map((s) => {
    const guardrails: NonNullable<EngineState["guardrails"]> = {
      timeoutMs: s.tool?.timeoutMs ?? 30_000,
      retryMax: s.tool?.retry?.max ?? 0,
      retryBackoffMs: s.tool?.retry?.backoffMs ?? 0,
      retryOn: s.guardrails?.retryOn as RetryReason[] | undefined,
    };
    if (s.type === "HUMAN" && s.human?.timeoutMs != null) {
      guardrails.timeoutMs = Math.max(
        guardrails.timeoutMs,
        s.human.timeoutMs + 5_000
      );
      guardrails.retryMax = 0;
    }
    return {
      id: s.id,
      type: s.type,
      label: s.label,
      inputSchema: s.inputSchema,
      outputSchema: s.outputSchema,
      onErrorSignal: s.onError?.signal ?? "::SCRIPT.ERROR",
      guardrails,
    };
  });

  const edges: EngineEdge[] = [];
  for (const s of dslStates) {
    for (const t of s.transitions ?? []) {
      edges.push({
        from: s.id,
        on: t.on,
        to: t.to,
        kind: t.kind as EngineEdge["kind"],
        maxIterations: t.maxIterations,
      });
    }
  }

  return { states, edges };
}

function stringifySchema(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/** Rebuild canvas node data from persisted DSL so resume can run executors. */
export function nodesFromDsl(
  dslJson: string
): Map<string, { id: string; data: StateNodeData }> {
  const doc = JSON.parse(dslJson) as DslDocument;
  const map = new Map<string, { id: string; data: StateNodeData }>();
  for (const s of doc.states ?? []) {
    const type = (s.type as FSMStateType) ?? "SCRIPT";
    const data = defaultNodeData(type, s.label ?? s.id);
    data.onError = { signal: s.onError?.signal ?? data.onError.signal };
    if (s.tool) {
      data.script = {
        ...data.script,
        toolName: s.tool.name ?? data.script.toolName,
        language: (s.tool.language as StateNodeData["script"]["language"]) ?? data.script.language,
      };
      data.guardrails = {
        ...data.guardrails,
        timeoutMs: s.tool.timeoutMs ?? data.guardrails.timeoutMs,
        retryMax: s.tool.retry?.max ?? data.guardrails.retryMax,
        retryBackoffMs: s.tool.retry?.backoffMs ?? data.guardrails.retryBackoffMs,
        retryOn: s.guardrails?.retryOn as StateNodeData["guardrails"]["retryOn"],
      };
    }
    if (s.llm) {
      data.ai = {
        ...data.ai,
        credentialId: s.llm.credentialId ?? "",
        model: s.llm.model ?? data.ai.model,
        temperature: s.llm.temperature ?? data.ai.temperature,
        maxTokens: s.llm.maxTokens ?? data.ai.maxTokens,
        systemPrompt: s.llm.systemPrompt ?? "",
        outputSchema: stringifySchema(s.llm.outputSchema),
      };
    }
    if (s.http) {
      data.http = {
        ...data.http,
        method: (s.http.method as StateNodeData["http"]["method"]) ?? "GET",
        urlTemplate: s.http.urlTemplate ?? "",
        headers: s.http.headers ?? {},
        bodyTemplate: s.http.bodyTemplate,
        successSignals: s.http.successSignals ?? ["::HTTP.NEXT"],
        authCredentialId: s.http.authCredentialId,
      };
    }
    if (s.validate?.schema) {
      data.validate = {
        ...data.validate,
        kind: "schema",
        schema: stringifySchema(s.validate.schema),
      };
    }
    if (s.human) {
      data.human = {
        ...data.human,
        prompt: s.human.prompt ?? "",
        approvalSignals: s.human.approvalSignals ?? data.human.approvalSignals,
        timeoutMs: s.human.timeoutMs,
      };
    }
    if (s.successCondition) data.successCondition = s.successCondition;
    if (s.toolAccess) data.toolAccess = s.toolAccess;
    if (s.retainContext) data.retainContext = true;
    map.set(s.id, { id: s.id, data });
  }
  return map;
}
