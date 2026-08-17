import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSignal, type Emission } from "@fsm/engine";
import {
  classifyGrpcError,
  createToolBridge,
  GrpcStatus,
  registerFakeTool,
  type ToolBridge,
  type ToolDescriptor,
  type ToolEndpoint,
  type ToolRequest,
  type ToolResponse,
} from "@fsm/grpc-bridge";
import { isValidSignalNamespace } from "@/lib/registry";
import type { StateNodeData, ToolLanguage } from "@/lib/fsm-types";
import type { Executor, ExecutorContext } from "./types";

export const TOOL_RUNTIME_UNAVAILABLE = "TOOL_RUNTIME_UNAVAILABLE";
export const TOOL_NOT_REGISTERED = "TOOL_NOT_REGISTERED";
export const MALFORMED_TOOL_SIGNAL = "MALFORMED_TOOL_SIGNAL";

const FAKE_ENDPOINT: ToolEndpoint = {
  id: "fake",
  address: "fake://tools",
  language: "python",
};

export interface ScriptToolRef {
  stateId: string;
  toolName: string;
  language: ToolLanguage;
  code: string;
}

export interface PreparedToolRuntime {
  bridge: ToolBridge;
  endpoints: ToolEndpoint[];
  names: Set<string>;
  scratchDir?: string;
}

export type PrepareToolRuntimeResult =
  | { status: "skipped" }
  | { status: "ready"; runtime: PreparedToolRuntime }
  | {
      status: "rejected";
      code: string;
      message: string;
      stateId?: string;
      toolName?: string;
    };

export interface ScriptExecutorDeps {
  bridge?: ToolBridge;
  endpoints?: ToolEndpoint[];
  /** When true, register this node's script as a fake ::SCRIPT.NEXT handler. */
  registerNodeAsFake?: boolean;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const preparedByRun = new Map<number, PreparedToolRuntime>();

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

function envFlag(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[name];
  return v === "1" || v === "true";
}

export function isFakeOrMockTools(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlag("FSM_FAKE_TOOLS", env) || envFlag("FSM_MOCK_PROVIDER", env);
}

export function parseToolEndpoints(
  raw: string | undefined = process.env.TOOL_ENDPOINTS
): ToolEndpoint[] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const endpoints: ToolEndpoint[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (typeof o.id !== "string" || typeof o.address !== "string") continue;
      const language =
        o.language === "bash" ? "bash" : o.language === "python" ? "python" : null;
      if (!language) continue;
      endpoints.push({ id: o.id, address: o.address, language });
    }
    return endpoints.length > 0 ? endpoints : null;
  } catch {
    return null;
  }
}

export function resolveToolEndpoints(
  env: NodeJS.ProcessEnv = process.env
): ToolEndpoint[] | null {
  const parsed = parseToolEndpoints(env.TOOL_ENDPOINTS);
  if (parsed) return parsed;
  if (isFakeOrMockTools(env)) return [FAKE_ENDPOINT];
  return null;
}

export function getPreparedToolRuntime(
  runId: number
): PreparedToolRuntime | undefined {
  return preparedByRun.get(runId);
}

export function setPreparedToolRuntime(
  runId: number,
  runtime: PreparedToolRuntime
): void {
  preparedByRun.set(runId, runtime);
}

export function clearPreparedToolRuntime(runId?: number): void {
  if (runId == null) preparedByRun.clear();
  else preparedByRun.delete(runId);
}

export function collectScriptTools(
  nodes: Array<{ id: string; data?: Partial<StateNodeData> | StateNodeData }>,
  states?: Array<{ id: string; type: string }>
): ScriptToolRef[] {
  const byId = new Map<string, ScriptToolRef>();
  for (const node of nodes) {
    const data = node.data;
    if (!data || data.stateType !== "SCRIPT") continue;
    const script = data.script;
    byId.set(node.id, {
      stateId: node.id,
      toolName: script?.toolName?.trim() ?? "",
      language: script?.language ?? "python",
      code: script?.code ?? "",
    });
  }
  if (states) {
    for (const state of states) {
      if (state.type !== "SCRIPT" || byId.has(state.id)) continue;
      byId.set(state.id, {
        stateId: state.id,
        toolName: "",
        language: "python",
        code: "",
      });
    }
  }
  return [...byId.values()];
}

export function registerCanvasScriptsAsFakeTools(tools: ScriptToolRef[]): void {
  for (const tool of tools) {
    if (!tool.toolName) continue;
    const name = tool.toolName;
    registerFakeTool({
      descriptor: {
        name,
        language: tool.language === "bash" ? "bash" : "python",
        description: `Canvas SCRIPT ${tool.stateId}`,
      },
      handler: () => ({
        logs: [`${name}: start`],
        response: {
          exitCode: 0,
          signal: "::SCRIPT.NEXT",
          result: {},
          stderr: "",
        },
      }),
    });
  }
}

function extForLanguage(language: ToolLanguage): string {
  if (language === "bash") return "sh";
  if (language === "cpp") return "cpp";
  return "py";
}

export function materializeScripts(
  runId: number,
  tools: ScriptToolRef[],
  scratchRoot?: string
): string {
  const root = join(
    scratchRoot ?? process.env.FSM_TOOLS_SCRATCH ?? join(tmpdir(), "fsm-tools"),
    String(runId)
  );
  mkdirSync(root, { recursive: true });
  for (const tool of tools) {
    if (!tool.toolName) continue;
    const file = join(root, `${tool.toolName}.${extForLanguage(tool.language)}`);
    writeFileSync(file, tool.code, "utf8");
  }
  return root;
}

export function pickEndpoint(
  endpoints: ToolEndpoint[],
  language: string
): ToolEndpoint {
  const lang = language === "bash" ? "bash" : "python";
  const found = endpoints.find((e) => e.language === lang) ?? endpoints[0];
  if (!found) {
    throw new Error("no tool endpoints");
  }
  return found;
}

async function describeAll(
  bridge: ToolBridge,
  endpoints: ToolEndpoint[]
): Promise<ToolDescriptor[]> {
  const seen = new Set<string>();
  const out: ToolDescriptor[] = [];
  let lastErr: unknown;
  let any = false;
  for (const endpoint of endpoints) {
    try {
      const list = await bridge.describe(endpoint);
      any = true;
      for (const d of list) {
        if (seen.has(d.name)) continue;
        seen.add(d.name);
        out.push(d);
      }
    } catch (err) {
      lastErr = err;
    }
  }
  if (!any) {
    throw lastErr ?? new Error("describe failed");
  }
  return out;
}

export async function handshakeToolRegistry(opts: {
  bridge: ToolBridge;
  endpoints: ToolEndpoint[];
  tools: ScriptToolRef[];
}): Promise<
  | { ok: true; names: Set<string> }
  | {
      ok: false;
      code: string;
      message: string;
      stateId?: string;
      toolName?: string;
    }
> {
  let descriptors: ToolDescriptor[];
  try {
    descriptors = await describeAll(opts.bridge, opts.endpoints);
  } catch (err) {
    const classified = classifyGrpcError(err);
    return {
      ok: false,
      code:
        classified.code === GrpcStatus.UNAVAILABLE
          ? TOOL_RUNTIME_UNAVAILABLE
          : classified.code,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const names = new Set(descriptors.map((d) => d.name));
  for (const tool of opts.tools) {
    if (!tool.toolName || !names.has(tool.toolName)) {
      return {
        ok: false,
        code: TOOL_NOT_REGISTERED,
        message: `Unknown tool ${tool.toolName || "(empty)"}`,
        stateId: tool.stateId,
        toolName: tool.toolName,
      };
    }
  }
  return { ok: true, names };
}

export async function prepareToolRuntime(opts: {
  runId: number;
  tools: ScriptToolRef[];
  env?: NodeJS.ProcessEnv;
  bridge?: ToolBridge;
  endpoints?: ToolEndpoint[];
  scratchRoot?: string;
}): Promise<PrepareToolRuntimeResult> {
  if (opts.tools.length === 0) return { status: "skipped" };
  const env = opts.env ?? process.env;
  const endpoints = opts.endpoints ?? resolveToolEndpoints(env);
  if (!endpoints) return { status: "skipped" };

  if (isFakeOrMockTools(env)) {
    registerCanvasScriptsAsFakeTools(opts.tools);
  }

  const bridge = opts.bridge ?? createToolBridge(endpoints);
  const handshake = await handshakeToolRegistry({
    bridge,
    endpoints,
    tools: opts.tools,
  });
  if (!handshake.ok) {
    return {
      status: "rejected",
      code: handshake.code,
      message: handshake.message,
      stateId: handshake.stateId,
      toolName: handshake.toolName,
    };
  }

  let scratchDir: string | undefined;
  try {
    scratchDir = materializeScripts(opts.runId, opts.tools, opts.scratchRoot);
  } catch {
    scratchDir = undefined;
  }

  const runtime: PreparedToolRuntime = {
    bridge,
    endpoints,
    names: handshake.names,
    scratchDir,
  };
  setPreparedToolRuntime(opts.runId, runtime);
  return { status: "ready", runtime };
}

function argsFromPayload(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
    }
  }
  return out;
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function errorEmission(
  code: string,
  extra: Record<string, unknown> = {}
): Emission {
  return {
    signal: "::SCRIPT.ERROR",
    payload: { code, ...extra },
  };
}

function mapResponse(
  response: ToolResponse,
  logs: string[]
): Emission {
  if (response.exitCode !== 0) {
    return errorEmission("TOOL_EXIT", {
      exitCode: response.exitCode,
      stderr: response.stderr,
      logs: logs.slice(-10),
    });
  }
  const parsed = parseSignal(response.signal || "");
  if (!isValidSignalNamespace(parsed.signal)) {
    return errorEmission(MALFORMED_TOOL_SIGNAL, {
      raw: response.signal,
      lastLogs: logs.slice(-10),
    });
  }
  return {
    signal: parsed.signal,
    payload: {
      ...parsed.payload,
      ...(response.result != null ? { result: response.result } : {}),
    },
    toHint: parsed.toHint,
  };
}

export function createScriptExecutor(deps: ScriptExecutorDeps = {}): Executor {
  const sleep = deps.sleep ?? DEFAULT_SLEEP;

  return async function executeScript(ctx: ExecutorContext): Promise<Emission> {
    throwIfAborted(ctx.signal);

    const language = ctx.node?.data.script?.language ?? "python";
    const toolName = ctx.node?.data.script?.toolName?.trim() ?? "";
    const code = ctx.node?.data.script?.code ?? "";
    const retryMax = ctx.state.guardrails?.retryMax ?? 0;
    const backoff = ctx.state.guardrails?.retryBackoffMs ?? 0;
    const timeoutMs = ctx.state.guardrails?.timeoutMs ?? 30_000;

    const prepared = getPreparedToolRuntime(ctx.runId);
    let bridge = deps.bridge ?? prepared?.bridge;
    let endpoints = deps.endpoints ?? prepared?.endpoints ?? null;

    if (!bridge || !endpoints) {
      endpoints = resolveToolEndpoints();
      if (!endpoints) {
        await ctx.emit({
          stateId: ctx.state.id,
          kind: "state.error",
          payload: { code: TOOL_RUNTIME_UNAVAILABLE },
        });
        return errorEmission(TOOL_RUNTIME_UNAVAILABLE);
      }
      bridge = createToolBridge(endpoints);
    }

    const registerNode =
      deps.registerNodeAsFake ??
      (deps.bridge == null && isFakeOrMockTools());
    if (registerNode && toolName) {
      registerCanvasScriptsAsFakeTools([
        {
          stateId: ctx.state.id,
          toolName,
          language,
          code,
        },
      ]);
    }

    if (!toolName) {
      await ctx.emit({
        stateId: ctx.state.id,
        kind: "state.error",
        payload: { code: TOOL_NOT_REGISTERED, toolName: "" },
      });
      return errorEmission(TOOL_NOT_REGISTERED, { toolName: "" });
    }

    const endpoint = pickEndpoint(endpoints, language);
    const req: ToolRequest = {
      toolName,
      runId: String(ctx.runId),
      stateId: ctx.state.id,
      args: argsFromPayload(ctx.payload),
      payload: ctx.payload,
      timeoutMs,
    };

    const maxAttempts = Math.max(1, retryMax + 1);
    let lastCode = "TOOL_ERROR";
    let lastMessage = "tool failed";
    const logs: string[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      throwIfAborted(ctx.signal);
      try {
        let response: ToolResponse | undefined;
        for await (const event of bridge.executeStream(req, {
          signal: ctx.signal,
          endpoint,
        })) {
          throwIfAborted(ctx.signal);
          if (event.kind === "log") {
            logs.push(event.line);
            await ctx.emit({
              stateId: ctx.state.id,
              kind: "state.log",
              payload: { line: event.line },
            });
          } else if (event.kind === "done") {
            response = event.response;
          }
        }
        throwIfAborted(ctx.signal);
        if (!response) {
          return errorEmission("TOOL_NO_RESPONSE", { logs: logs.slice(-10) });
        }
        return mapResponse(response, logs);
      } catch (err) {
        if (
          (err instanceof DOMException && err.name === "AbortError") ||
          ctx.signal.aborted
        ) {
          throw abortError();
        }
        const classified = classifyGrpcError(err);
        lastCode = classified.code;
        lastMessage = err instanceof Error ? err.message : String(err);
        if (!classified.retryable || attempt >= maxAttempts) {
          await ctx.emit({
            stateId: ctx.state.id,
            kind: "state.error",
            payload: { code: lastCode, attempts: attempt, message: lastMessage },
          });
          return errorEmission(lastCode, {
            attempts: attempt,
            message: lastMessage,
            logs: logs.slice(-10),
          });
        }
        await ctx.emit({
          stateId: ctx.state.id,
          kind: "state.retry",
          payload: { attempt, code: lastCode },
        });
        if (backoff > 0) await sleep(backoff, ctx.signal);
      }
    }

    await ctx.emit({
      stateId: ctx.state.id,
      kind: "state.error",
      payload: { code: lastCode },
    });
    return errorEmission(lastCode, { message: lastMessage });
  };
}

export const executeScript: Executor = createScriptExecutor();
