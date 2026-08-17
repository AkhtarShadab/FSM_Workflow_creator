import { describe, expect, it, vi } from "vitest";
import type { StateNodeData } from "@/lib/fsm-types";
import { createAiExecutor } from "@/lib/executors/ai";
import { getExecutor } from "@/lib/executors/registry";
import { dropStateMemory } from "@/lib/run-context";
import { RUN_CURSOR_KIND } from "@/lib/run-cursor";
import { TOOL_DENIED_SIGNAL } from "@/lib/tool-grants";
import {
  createMemoryRunStore,
  createRunSupervisor,
} from "@/lib/run-supervisor";

const START_END = {
  states: [
    {
      id: "S0",
      type: "START",
      guardrails: { timeoutMs: 5_000, retryMax: 0, retryBackoffMs: 0 },
    },
    {
      id: "V1",
      type: "VALIDATE",
      guardrails: { timeoutMs: 5_000, retryMax: 0, retryBackoffMs: 0 },
    },
    { id: "END", type: "END" },
  ],
  edges: [
    { from: "S0", on: "::SCRIPT.NEXT", to: "V1" },
    { from: "V1", on: "::VALIDATE.NEXT", to: "END" },
  ],
};

describe("014 run contract wiring", () => {
  it("resume skips lastCompletedStateId and continues at nextStateId", async () => {
    const store = createMemoryRunStore();
    const supervisor = createRunSupervisor({ store });
    const visited: string[] = [];

    await supervisor.executeRun(50, {
      states: [
        {
          id: "S0",
          type: "START",
          guardrails: { timeoutMs: 5_000, retryMax: 0, retryBackoffMs: 0 },
        },
        {
          id: "S1",
          type: "SCRIPT",
          guardrails: { timeoutMs: 5_000, retryMax: 0, retryBackoffMs: 0 },
        },
        {
          id: "S2",
          type: "SCRIPT",
          guardrails: { timeoutMs: 5_000, retryMax: 0, retryBackoffMs: 0 },
        },
        { id: "END", type: "END" },
      ],
      edges: [
        { from: "S0", on: "::SCRIPT.NEXT", to: "S1" },
        { from: "S1", on: "::SCRIPT.NEXT", to: "S2" },
        { from: "S2", on: "::SCRIPT.NEXT", to: "END" },
      ],
      executeState: async ({ state }) => {
        visited.push(state.id);
        return "::SCRIPT.NEXT";
      },
      initialStateId: "S2",
      initialPayload: { resumed: true },
    });

    expect(visited).toEqual(["S2"]);
    expect(store.statuses.get(50)).toBe("succeeded");
  });

  it("verify fail blocks transition when payload contains VERIFY_FAIL", async () => {
    const store = createMemoryRunStore();
    const supervisor = createRunSupervisor({ store });

    await supervisor.executeRun(51, {
      states: [
        {
          id: "S0",
          type: "START",
          guardrails: { timeoutMs: 5_000, retryMax: 0, retryBackoffMs: 0 },
        },
        {
          id: "V1",
          type: "VALIDATE",
          guardrails: { timeoutMs: 5_000, retryMax: 0, retryBackoffMs: 0 },
        },
        { id: "END", type: "END" },
      ],
      edges: [
        { from: "S0", on: "::SCRIPT.NEXT", to: "V1" },
        { from: "V1", on: "::VALIDATE.NEXT", to: "END" },
      ],
      nodesById: new Map([
        [
          "V1",
          {
            id: "V1",
            data: {
              successCondition: {
                kind: "llm_verify",
                credentialId: "1",
                modelId: "judge",
                rubric: "pass",
                onFail: "error_signal",
              },
            } as unknown as StateNodeData,
          },
        ],
      ]),
      executeState: async ({ state }) => {
        if (state.id === "V1") {
          return {
            signal: "::VALIDATE.NEXT",
            payload: { result: "VERIFY_FAIL" },
          };
        }
        return "::SCRIPT.NEXT";
      },
    });

    expect(store.statuses.get(51)).toBe("failed");
    expect(
      store.events.some(
        (e) =>
          e.kind === "state.retry" &&
          (e.payload as { reason?: string })?.reason === "verify_fail"
      )
    ).toBe(false);
    expect(
      store.events.filter((e) => e.kind === "state.transition").length
    ).toBe(1);
  });

  it("denied tool does not execute AI chat and emits TOOL_DENIED", async () => {
    process.env.FSM_MOCK_PROVIDER = "1";
    const store = createMemoryRunStore();
    const chatSpy = vi.fn();
    const supervisor = createRunSupervisor({
      store,
      getExecutor: (type) =>
        type === "AI"
          ? createAiExecutor({
              isMock: () => true,
              adapter: {
                id: "mock",
                listModels: async () => [],
                chat: chatSpy,
              },
            })
          : getExecutor(type),
    });

    await supervisor.executeRun(52, {
      states: [
        { id: "S0", type: "START" },
        { id: "AI1", type: "AI" },
        { id: "END", type: "END" },
      ],
      edges: [
        { from: "S0", on: "::SCRIPT.NEXT", to: "AI1" },
        { from: "AI1", on: "::AI.TOOL_DENIED", to: "END" },
      ],
      nodesById: new Map([
        [
          "AI1",
          {
            id: "AI1",
            data: {
              ai: {
                credentialId: "",
                model: "mock-chat",
                temperature: 0,
                maxTokens: 32,
                systemPrompt: "INVOKE_TOOL:search",
                outputSchema: "",
              },
              toolAccess: { mode: "allowlist", allow: [] },
            } as unknown as StateNodeData,
          },
        ],
      ]),
    });

    expect(chatSpy).not.toHaveBeenCalled();
    expect(
      store.events.some(
        (e) =>
          e.kind === "state.output" &&
          (e.payload as { signal?: string })?.signal === TOOL_DENIED_SIGNAL
      )
    ).toBe(true);
    delete process.env.FSM_MOCK_PROVIDER;
  });

  it("missing cursor resumes from START and emits a warning", async () => {
    const store = createMemoryRunStore();
    store.statuses.set(56, "interrupted");
    const supervisor = createRunSupervisor({
      store,
      loadRunDefinition: async () => ({
        json: JSON.stringify({
          states: [
            {
              id: "S0",
              type: "START",
              transitions: [{ on: "::SCRIPT.NEXT", to: "END" }],
            },
            { id: "END", type: "END" },
          ],
        }),
      }),
    });
    const result = await supervisor.resume(56);
    expect(result).toEqual({ ok: true });
    await supervisor.getActive(56)?.done;
    expect(
      store.events.some((e) => e.kind === "run.resume_without_cursor")
    ).toBe(true);
    expect(
      store.events.some((e) => e.kind === "state.start" && e.stateId === "S0")
    ).toBe(true);
    expect(store.statuses.get(56)).toBe("succeeded");
  });

  it("resume while running returns 409", async () => {
    const store = createMemoryRunStore();
    store.statuses.set(57, "running");
    const supervisor = createRunSupervisor({ store });
    const result = await supervisor.resume(57);
    expect(result).toEqual({
      ok: false,
      error: "ALREADY_RUNNING",
      status: 409,
    });
  });

  it("dropStateMemory clears history after success via injected store", async () => {
    const store = createMemoryRunStore();
    const dropSpy = vi.spyOn(
      await import("@/lib/run-context"),
      "dropStateMemory"
    );
    const supervisor = createRunSupervisor({ store });

    await supervisor.executeRun(53, START_END);
    expect(dropSpy).toHaveBeenCalled();
    const lastCall = dropSpy.mock.calls.at(-1);
    expect(lastCall?.[1]).toMatchObject({ stateId: "V1", retainContext: false });
    dropSpy.mockRestore();
  });

  it("persists engine onRetry as state.retry events", async () => {
    const store = createMemoryRunStore();
    const supervisor = createRunSupervisor({ store });
    let calls = 0;

    await supervisor.executeRun(54, {
      states: [
        {
          id: "S0",
          type: "START",
          guardrails: { timeoutMs: 5_000, retryMax: 1, retryBackoffMs: 0 },
        },
        { id: "END", type: "END" },
      ],
      edges: [{ from: "S0", on: "::SCRIPT.NEXT", to: "END" }],
      executeState: async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return "::SCRIPT.NEXT";
      },
    });

    expect(
      store.events.some(
        (e) =>
          e.kind === "state.retry" &&
          (e.payload as { reason?: string })?.reason === "execute"
      )
    ).toBe(true);
    expect(store.statuses.get(54)).toBe("succeeded");
  });

  it("writes run.cursor after successful verify", async () => {
    const store = createMemoryRunStore();
    const supervisor = createRunSupervisor({ store });
    await supervisor.executeRun(55, START_END);
    const cursor = store.events.filter((e) => e.kind === RUN_CURSOR_KIND).at(-1);
    expect(cursor?.payload).toMatchObject({
      lastCompletedStateId: "V1",
      nextStateId: "END",
    });
  });

  it("second AI state does not see first state's history after drop", async () => {
    const store = createMemoryRunStore();
    const historyLens: number[] = [];
    const supervisor = createRunSupervisor({
      store,
      getExecutor: (type) => {
        if (type !== "AI") return getExecutor(type);
        return async (ctx) => {
          historyLens.push(ctx.history?.length ?? 0);
          ctx.history?.push({
            role: "assistant",
            content: `secret-cot-${ctx.state.id}`,
          });
          return {
            signal: "::AI.NEXT",
            payload: { text: `out-${ctx.state.id}` },
          };
        };
      },
    });

    await supervisor.executeRun(58, {
      states: [
        { id: "S0", type: "START" },
        { id: "AI1", type: "AI" },
        { id: "AI2", type: "AI" },
        { id: "END", type: "END" },
      ],
      edges: [
        { from: "S0", on: "::SCRIPT.NEXT", to: "AI1" },
        { from: "AI1", on: "::AI.NEXT", to: "AI2" },
        { from: "AI2", on: "::AI.NEXT", to: "END" },
      ],
    });

    expect(store.statuses.get(58)).toBe("succeeded");
    expect(historyLens).toEqual([0, 0]);
  });
});

describe("dropStateMemory contract", () => {
  it("keeps vars[stateId] after drop", () => {
    const ctx = {
      vars: { S1: { ok: true } },
      payload: { ok: true },
      history: [{ role: "assistant" as const, content: "secret" }],
      toolLogs: ["log"],
      ledger: { runId: 1, totals: { tokensIn: 0, tokensOut: 0 }, byState: {} },
    };
    const next = dropStateMemory(ctx, { stateId: "S1" });
    expect(next.history).toEqual([]);
    expect(next.vars.S1).toEqual({ ok: true });
  });
});
