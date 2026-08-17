import { afterEach, describe, expect, it } from "vitest";
import {
  classifyGrpcError,
  createToolBridge,
  GrpcStatus,
  GrpcStatusError,
  LOG_BYTE_LIMIT,
  LOG_TRUNCATED,
  resetFakeTools,
  type ToolEndpoint,
  type ToolEvent,
  type ToolRequest,
} from "./index";

const endpoint: ToolEndpoint = {
  id: "fake-python",
  address: "fake://python",
  language: "python",
};

function req(toolName: string, extra?: Partial<ToolRequest>): ToolRequest {
  return {
    toolName,
    runId: "run-1",
    stateId: "state-script",
    args: { text: "hi" },
    payload: { n: 1 },
    timeoutMs: 5_000,
    ...extra,
  };
}

async function collect(
  iter: AsyncIterable<ToolEvent>,
): Promise<ToolEvent[]> {
  const events: ToolEvent[] = [];
  for await (const event of iter) events.push(event);
  return events;
}

describe("grpc-bridge fake server", () => {
  afterEach(() => {
    resetFakeTools();
    delete process.env.FSM_FAKE_TOOLS;
  });

  it("describe() against fake returns the registered tool list", async () => {
    const bridge = createToolBridge([endpoint]);
    const tools = await bridge.describe(endpoint);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["echo", "fail", "slow", "verbose"]));
    expect(await bridge.health(endpoint)).toBe("serving");
  });

  it("execute maps ToolResponse including non-zero exitCode", async () => {
    const bridge = createToolBridge([endpoint]);
    const ac = new AbortController();
    const echoed = await bridge.execute(req("echo"), { signal: ac.signal, endpoint });
    expect(echoed.exitCode).toBe(0);
    expect(echoed.signal).toBe('::SCRIPT.NEXT|message="ok"');
    expect(echoed.result).toEqual({ args: { text: "hi" }, payload: { n: 1 } });
    expect(echoed.stderr).toBe("");

    const failed = await bridge.execute(req("fail"), { signal: ac.signal, endpoint });
    expect(failed.exitCode).toBe(1);
    expect(failed.signal).toBe("::SCRIPT.ERROR");
    expect(failed.stderr).toBe("tool failed");
  });

  it("executeStream yields logs then done", async () => {
    const bridge = createToolBridge([endpoint]);
    const ac = new AbortController();
    const events = await collect(
      bridge.executeStream(req("echo"), { signal: ac.signal, endpoint }),
    );
    expect(events[0]).toEqual({ kind: "log", line: "echo: start" });
    expect(events[1]).toEqual({ kind: "log", line: "echo: tool=echo" });
    const done = events.at(-1);
    expect(done).toMatchObject({
      kind: "done",
      response: { exitCode: 0, signal: '::SCRIPT.NEXT|message="ok"' },
    });
  });

  it("abort mid-stream stops events", async () => {
    const bridge = createToolBridge([endpoint]);
    const ac = new AbortController();
    const events: ToolEvent[] = [];
    const consume = async () => {
      for await (const event of bridge.executeStream(req("slow"), {
        signal: ac.signal,
        endpoint,
      })) {
        events.push(event);
        if (event.kind === "log") ac.abort();
      }
    };
    await consume().catch(() => undefined);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === "done")).toBe(false);
    expect(events.filter((e) => e.kind === "log").length).toBeLessThan(4);
  });

  it("large logs are truncated with LOG_TRUNCATED while the signal is kept", async () => {
    const bridge = createToolBridge([endpoint]);
    const ac = new AbortController();
    const events = await collect(
      bridge.executeStream(req("verbose"), { signal: ac.signal, endpoint }),
    );
    const logs = events.filter((e): e is Extract<ToolEvent, { kind: "log" }> => e.kind === "log");
    const marker = logs.findIndex((e) => e.line === LOG_TRUNCATED);
    expect(marker).toBeGreaterThanOrEqual(0);
    expect(logs.slice(marker + 1)).toEqual([]);

    const encoder = new TextEncoder();
    const bytesBefore = logs
      .slice(0, marker)
      .reduce((n, e) => n + encoder.encode(e.line).byteLength, 0);
    expect(bytesBefore).toBeLessThanOrEqual(LOG_BYTE_LIMIT);

    const done = events.find((e) => e.kind === "done");
    expect(done?.kind).toBe("done");
    if (done?.kind === "done") {
      expect(done.response.signal).toBe('::SCRIPT.NEXT|message="verbose-done"');
      expect(done.response.exitCode).toBe(0);
    }
  });

  it("unknown tool / INVALID_ARGUMENT is not retryable; UNAVAILABLE is retryable", async () => {
    const bridge = createToolBridge([endpoint]);
    const ac = new AbortController();
    let unknown: unknown;
    try {
      await bridge.execute(req("no-such-tool"), { signal: ac.signal, endpoint });
    } catch (err) {
      unknown = err;
    }
    expect(unknown).toBeInstanceOf(GrpcStatusError);
    expect(classifyGrpcError(unknown)).toEqual({
      code: GrpcStatus.INVALID_ARGUMENT,
      retryable: false,
    });

    const remote: ToolEndpoint = {
      id: "py-remote",
      address: "127.0.0.1:50051",
      language: "python",
    };
    const live = createToolBridge([remote]);
    expect(await live.health(remote)).toBe("not_serving");
    let unavailable: unknown;
    try {
      await live.describe(remote);
    } catch (err) {
      unavailable = err;
    }
    expect(classifyGrpcError(unavailable)).toEqual({
      code: GrpcStatus.UNAVAILABLE,
      retryable: true,
    });

    expect(
      classifyGrpcError(new GrpcStatusError(GrpcStatus.INVALID_ARGUMENT, "bad")),
    ).toEqual({ code: "INVALID_ARGUMENT", retryable: false });
    expect(
      classifyGrpcError(new GrpcStatusError(GrpcStatus.UNAVAILABLE, "down")),
    ).toEqual({ code: "UNAVAILABLE", retryable: true });
  });

  it("FSM_FAKE_TOOLS=1 uses the in-process fake even for non-fake addresses", async () => {
    process.env.FSM_FAKE_TOOLS = "1";
    const remote: ToolEndpoint = {
      id: "py-remote",
      address: "127.0.0.1:50051",
      language: "python",
    };
    const bridge = createToolBridge([remote]);
    expect(await bridge.health(remote)).toBe("serving");
    const tools = await bridge.describe(remote);
    expect(tools.some((t) => t.name === "echo")).toBe(true);
  });
});
