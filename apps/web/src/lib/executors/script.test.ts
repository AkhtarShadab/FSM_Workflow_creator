import { afterEach, describe, expect, it } from "vitest";
import {
  createToolBridge,
  registerFakeTool,
  resetFakeTools,
  type ToolEndpoint,
} from "@fsm/grpc-bridge";
import type { StateNodeData } from "@/lib/fsm-types";
import {
  createMemoryRunStore,
  createRunSupervisor,
} from "@/lib/run-supervisor";
import type { RunEventDraft } from "./types";
import {
  TOOL_NOT_REGISTERED,
  TOOL_RUNTIME_UNAVAILABLE,
  MALFORMED_TOOL_SIGNAL,
  clearPreparedToolRuntime,
  createScriptExecutor,
  handshakeToolRegistry,
  executeScript,
} from "./script";

const fakeEndpoint: ToolEndpoint = {
  id: "fake-python",
  address: "fake://python",
  language: "python",
};

function scriptNode(
  toolName: string,
  extra?: Partial<StateNodeData["script"]>
): { id: string; data: StateNodeData } {
  return {
    id: "S1",
    data: {
      script: {
        toolName,
        language: "python",
        code: extra?.code ?? "def run(args, payload):\n    return {}\n",
        ...extra,
      },
    } as StateNodeData,
  };
}

function cleanEnv(): void {
  delete process.env.FSM_FAKE_TOOLS;
  delete process.env.FSM_MOCK_PROVIDER;
  delete process.env.TOOL_ENDPOINTS;
  resetFakeTools();
  clearPreparedToolRuntime();
}

describe("SCRIPT executor", () => {
  afterEach(cleanEnv);

  it("emits TOOL_RUNTIME_UNAVAILABLE when endpoints are unset", async () => {
    cleanEnv();
    const drafts: RunEventDraft[] = [];
    const emission = await executeScript({
      runId: 1,
      state: { id: "S1", type: "SCRIPT" },
      node: scriptNode("any_tool"),
      payload: {},
      signal: new AbortController().signal,
      emit: async (ev) => {
        drafts.push(ev);
      },
    });
    expect(emission).toMatchObject({
      signal: "::SCRIPT.ERROR",
      payload: { code: TOOL_RUNTIME_UNAVAILABLE },
    });
    expect(drafts.some((d) => d.kind === "state.error")).toBe(true);
  });

  it("runs via the fake bridge and streams state.log events", async () => {
    process.env.FSM_FAKE_TOOLS = "1";
    const drafts: RunEventDraft[] = [];
    const execute = createScriptExecutor();
    const emission = await execute({
      runId: 2,
      state: { id: "S1", type: "SCRIPT" },
      node: scriptNode("canvas_echo"),
      payload: { text: "hi" },
      signal: new AbortController().signal,
      emit: async (ev) => {
        drafts.push(ev);
      },
    });
    expect(emission).toMatchObject({ signal: "::SCRIPT.NEXT" });
    const logs = drafts.filter((d) => d.kind === "state.log");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]?.payload).toMatchObject({ line: "canvas_echo: start" });
  });

  it("maps ToolResponse signals through parseSignal (echo builtin)", async () => {
    const bridge = createToolBridge([fakeEndpoint]);
    const execute = createScriptExecutor({
      bridge,
      endpoints: [fakeEndpoint],
    });
    const emission = await execute({
      runId: 3,
      state: { id: "S1", type: "SCRIPT" },
      node: scriptNode("echo"),
      payload: { text: "hi" },
      signal: new AbortController().signal,
      emit: async () => undefined,
    });
    expect(emission).toMatchObject({
      signal: "::SCRIPT.NEXT",
      payload: { message: "ok" },
    });
  });

  it("maps non-zero exitCode to ::SCRIPT.ERROR with stderr", async () => {
    const bridge = createToolBridge([fakeEndpoint]);
    const execute = createScriptExecutor({
      bridge,
      endpoints: [fakeEndpoint],
    });
    const emission = await execute({
      runId: 4,
      state: { id: "S1", type: "SCRIPT" },
      node: scriptNode("fail"),
      payload: {},
      signal: new AbortController().signal,
      emit: async () => undefined,
    });
    expect(emission).toMatchObject({
      signal: "::SCRIPT.ERROR",
      payload: { code: "TOOL_EXIT", exitCode: 1, stderr: "tool failed" },
    });
  });

  it("aborts mid-stream and surfaces no further events", async () => {
    const bridge = createToolBridge([fakeEndpoint]);
    const execute = createScriptExecutor({
      bridge,
      endpoints: [fakeEndpoint],
    });
    const ac = new AbortController();
    const drafts: RunEventDraft[] = [];
    const run = execute({
      runId: 5,
      state: { id: "S1", type: "SCRIPT" },
      node: scriptNode("slow"),
      payload: {},
      signal: ac.signal,
      emit: async (ev) => {
        drafts.push(ev);
        if (ev.kind === "state.log") ac.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(drafts.some((d) => d.kind === "state.log")).toBe(true);
    expect(drafts.filter((d) => d.kind === "state.log").length).toBeLessThan(4);
    expect(
      drafts.every((d) => d.kind === "state.log" || d.kind === "state.error")
    ).toBe(true);
  });

  it("malformed final signal yields MALFORMED_TOOL_SIGNAL with log tail", async () => {
    registerFakeTool({
      descriptor: { name: "bad_signal", language: "python" },
      handler: () => ({
        logs: ["a", "b", "c"],
        response: {
          exitCode: 0,
          signal: "not-a-signal",
          result: {},
          stderr: "",
        },
      }),
    });
    const bridge = createToolBridge([fakeEndpoint]);
    const execute = createScriptExecutor({
      bridge,
      endpoints: [fakeEndpoint],
    });
    const emission = await execute({
      runId: 6,
      state: { id: "S1", type: "SCRIPT" },
      node: scriptNode("bad_signal"),
      payload: {},
      signal: new AbortController().signal,
      emit: async () => undefined,
    });
    expect(emission).toMatchObject({
      signal: "::SCRIPT.ERROR",
      payload: {
        code: MALFORMED_TOOL_SIGNAL,
        lastLogs: ["a", "b", "c"],
      },
    });
  });

  it("unknown tool name fails handshake before any state executes", async () => {
    process.env.TOOL_ENDPOINTS = JSON.stringify([fakeEndpoint]);
    const bridge = createToolBridge([fakeEndpoint]);
    const handshake = await handshakeToolRegistry({
      bridge,
      endpoints: [fakeEndpoint],
      tools: [
        {
          stateId: "SCR",
          toolName: "ghost_tool",
          language: "python",
          code: "pass",
        },
      ],
    });
    expect(handshake.ok).toBe(false);
    if (!handshake.ok) {
      expect(handshake.code).toBe(TOOL_NOT_REGISTERED);
      expect(handshake.toolName).toBe("ghost_tool");
    }

    const store = createMemoryRunStore();
    const supervisor = createRunSupervisor({ store });
    await supervisor.executeRun(99, {
      states: [
        { id: "S0", type: "START" },
        { id: "SCR", type: "SCRIPT" },
        { id: "END", type: "END" },
      ],
      edges: [
        { from: "S0", on: "::SCRIPT.NEXT", to: "SCR" },
        { from: "SCR", on: "::SCRIPT.NEXT", to: "END" },
      ],
      nodesById: new Map([
        [
          "SCR",
          {
            id: "SCR",
            data: {
              stateType: "SCRIPT",
              script: {
                toolName: "ghost_tool",
                language: "python",
                code: "pass",
              },
            } as StateNodeData,
          },
        ],
      ]),
    });

    expect(store.events.some((e) => e.kind === "state.start")).toBe(false);
    expect(store.statuses.get(99)).toBe("failed");
    const failed = store.events.find((e) => e.kind === "run.failed");
    expect(failed?.payload).toMatchObject({
      code: TOOL_NOT_REGISTERED,
      toolName: "ghost_tool",
    });
  });

  it("FSM_MOCK_PROVIDER=1 uses fake:// and succeeds with ::SCRIPT.NEXT", async () => {
    process.env.FSM_MOCK_PROVIDER = "1";
    const store = createMemoryRunStore();
    const supervisor = createRunSupervisor({ store });
    await supervisor.executeRun(8, {
      states: [
        { id: "S0", type: "START" },
        { id: "SCR", type: "SCRIPT" },
        { id: "END", type: "END" },
      ],
      edges: [
        { from: "S0", on: "::SCRIPT.NEXT", to: "SCR" },
        { from: "SCR", on: "::SCRIPT.NEXT", to: "END" },
      ],
      nodesById: new Map([
        [
          "SCR",
          {
            id: "SCR",
            data: {
              stateType: "SCRIPT",
              script: {
                toolName: "mock_tool",
                language: "python",
                code: "def run(args, payload):\n    return {}\n",
              },
            } as StateNodeData,
          },
        ],
      ]),
    });
    expect(store.statuses.get(8)).toBe("succeeded");
    expect(store.events.some((e) => e.kind === "state.log")).toBe(true);
    const output = store.events.find(
      (e) => e.stateId === "SCR" && e.kind === "state.output"
    );
    expect(output?.payload).toMatchObject({ signal: "::SCRIPT.NEXT" });
  });
});
