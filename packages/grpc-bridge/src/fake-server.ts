import type { ToolDescriptor, ToolEvent, ToolRequest, ToolResponse } from "@fsm/proto";
import { GrpcStatus, GrpcStatusError } from "./errors";

export const LOG_TRUNCATED = "LOG_TRUNCATED";
export const LOG_BYTE_LIMIT = 1024 * 1024;

export interface FakeToolResult {
  response: ToolResponse;
  logs?: string[];
  progress?: number[];
  /** Delay between streamed events so AbortSignal can fire mid-stream. */
  intervalMs?: number;
}

export type FakeToolHandler = (
  req: ToolRequest,
  ctx: { signal: AbortSignal },
) => FakeToolResult | Promise<FakeToolResult>;

export interface FakeToolSpec {
  descriptor: ToolDescriptor;
  handler: FakeToolHandler;
}

const utf8 = new TextEncoder();

const builtins: FakeToolSpec[] = [
  {
    descriptor: {
      name: "echo",
      language: "python",
      argSchema: { type: "object", properties: { text: { type: "string" } } },
      description: "Echoes args and payload; emits a SCRIPT.NEXT signal",
    },
    handler: (req) => ({
      logs: ["echo: start", `echo: tool=${req.toolName}`],
      progress: [100],
      response: {
        exitCode: 0,
        signal: '::SCRIPT.NEXT|message="ok"',
        result: { args: req.args, payload: req.payload },
        stderr: "",
      },
    }),
  },
  {
    descriptor: {
      name: "fail",
      language: "python",
      description: "Non-zero exit; still returns ToolResponse for ::SCRIPT.ERROR mapping",
    },
    handler: () => ({
      logs: ["fail: raising"],
      response: {
        exitCode: 1,
        signal: "::SCRIPT.ERROR",
        result: {},
        stderr: "tool failed",
      },
    }),
  },
  {
    descriptor: {
      name: "slow",
      language: "python",
      description: "Yields several log lines with a delay (abort tests)",
    },
    handler: () => ({
      logs: ["slow: 1", "slow: 2", "slow: 3", "slow: 4"],
      intervalMs: 40,
      response: {
        exitCode: 0,
        signal: "::SCRIPT.NEXT",
        result: {},
        stderr: "",
      },
    }),
  },
  {
    descriptor: {
      name: "verbose",
      language: "bash",
      description: "Emits more than 1 MiB of logs; signal remains on ToolResponse",
    },
    handler: () => {
      const chunk = "x".repeat(1024);
      const logs = Array.from({ length: 1536 }, (_, i) => `${i}:${chunk}`);
      return {
        logs,
        response: {
          exitCode: 0,
          signal: '::SCRIPT.NEXT|message="verbose-done"',
          result: { lines: logs.length },
          stderr: "",
        },
      };
    },
  },
];

const registry = new Map<string, FakeToolSpec>();

function seedDefaults(): void {
  if (registry.size > 0) return;
  for (const spec of builtins) registry.set(spec.descriptor.name, spec);
}

seedDefaults();

export function registerFakeTool(spec: FakeToolSpec): void {
  registry.set(spec.descriptor.name, spec);
}

export function resetFakeTools(): void {
  registry.clear();
  for (const spec of builtins) registry.set(spec.descriptor.name, spec);
}

export function listFakeDescriptors(): ToolDescriptor[] {
  seedDefaults();
  return [...registry.values()].map((s) => s.descriptor);
}

function getSpec(toolName: string): FakeToolSpec {
  seedDefaults();
  const spec = registry.get(toolName);
  if (!spec) {
    throw new GrpcStatusError(
      GrpcStatus.INVALID_ARGUMENT,
      `unknown tool: ${toolName}`,
    );
  }
  return spec;
}

export async function fakeExecute(
  req: ToolRequest,
  signal: AbortSignal,
): Promise<ToolResponse> {
  if (signal.aborted) {
    throw new GrpcStatusError(GrpcStatus.CANCELLED, "execute aborted");
  }
  const spec = getSpec(req.toolName);
  const result = await spec.handler(req, { signal });
  if (signal.aborted) {
    throw new GrpcStatusError(GrpcStatus.CANCELLED, "execute aborted");
  }
  return result.response;
}

function byteLength(s: string): number {
  return utf8.encode(s).byteLength;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new GrpcStatusError(GrpcStatus.CANCELLED, "stream aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new GrpcStatusError(GrpcStatus.CANCELLED, "stream aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Stream log/progress events then a terminal `done`. Logs over 1 MiB are
 * replaced with a LOG_TRUNCATED marker; the ToolResponse (and its signal)
 * is still yielded.
 */
export async function* fakeExecuteStream(
  req: ToolRequest,
  signal: AbortSignal,
): AsyncGenerator<ToolEvent> {
  if (signal.aborted) {
    throw new GrpcStatusError(GrpcStatus.CANCELLED, "stream aborted");
  }

  const spec = getSpec(req.toolName);
  let result: FakeToolResult;
  try {
    result = await spec.handler(req, { signal });
  } catch (err) {
    if (signal.aborted) return;
    throw err;
  }

  let bytes = 0;
  let truncated = false;

  try {
    for (const line of result.logs ?? []) {
      if (signal.aborted) return;
      if (!truncated) {
        const n = byteLength(line);
        if (bytes + n > LOG_BYTE_LIMIT) {
          yield { kind: "log", line: LOG_TRUNCATED };
          truncated = true;
        } else {
          bytes += n;
          yield { kind: "log", line };
        }
      }
      if (result.intervalMs) await sleep(result.intervalMs, signal);
    }

    for (const pct of result.progress ?? []) {
      if (signal.aborted) return;
      yield { kind: "progress", pct };
      if (result.intervalMs) await sleep(result.intervalMs, signal);
    }

    if (signal.aborted) return;
    yield { kind: "done", response: result.response };
  } catch (err) {
    if (signal.aborted) return;
    throw err;
  }
}
