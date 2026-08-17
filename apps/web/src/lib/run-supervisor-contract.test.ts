import { describe, expect, it, vi } from "vitest";
import type { StateNodeData } from "@/lib/fsm-types";
import { createAiExecutor } from "@/lib/executors/ai";
import { getExecutor } from "@/lib/executors/registry";
import { dropStateMemory } from "@/lib/run-context";
import { RUN_CURSOR_KIND, serializeRunCursor } from "@/lib/run-cursor";
import { TOOL_DENIED_SIGNAL } from "@/lib/tool-grants";
import {
  createMemoryRunStore,
  createRunSupervisor,
} from "@/lib/run-supervisor";

const START_VALIDATE_END = {
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

describe("014 supervisor contract (fake store)", () => {
  it("writes run.cursor after a successful verify", async () => {
    const store = createMemoryRunStore();
    const supervisor = createRunSupervisor({ store });
    await supervisor.executeRun(101, START_VALIDATE_END);
    const cursor = store.events.filter((e) => e.kind === RUN_CURSOR_KIND).at(-1);
    expect(cursor?.payload).toMatchObject({
      lastCompletedStateId: "V1",
      nextStateId: "END",
    });
    expect(store.statuses.get(101)).toBe("succeeded");
  });

  it("maps engine onRetry to state.retry with ::STATE.RETRY", async () => {
    const store = createMemoryRunStore();
    const supervisor = createRunSupervisor({ store });
    let calls = 0;
    await supervisor.executeRun(102, {
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
    const retry = store.events.find((e) => e.kind === "state.retry");
    expect(retry).toBeDefined();
    expect(retry?.payload).toMatchObject({ reason: "execute" });
    const signal = (retry?.payload as { signal?: string })?.signal ?? "";
    expect(signal.startsWith("::STATE.RETRY")).toBe(true);
    expect(calls).toBe(2);
    expect(store.statuses.get(102)).toBe("succeeded");
  });

  it("denied AI tool does not call chat and stops the turn", async () => {
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

    await supervisor.executeRun(103, {
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
    expect(store.events.some((e) => e.kind === "state.token")).toBe(false);
    delete process.env.FSM_MOCK_PROVIDER;
  });

  it("dropStateMemory is invoked after cursor write unless retainContext", async () => {
    const store = createMemoryRunStore();
    const dropSpy = vi.spyOn(
      await import("@/lib/run-context"),
      "dropStateMemory"
    );
    const supervisor = createRunSupervisor({ store });
    await supervisor.executeRun(104, START_VALIDATE_END);
    expect(dropSpy).toHaveBeenCalled();
    expect(dropSpy.mock.calls.some((c) => c[1]?.retainContext === true)).toBe(
      false
    );
    dropSpy.mockRestore();
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

    await supervisor.executeRun(105, {
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

    expect(store.statuses.get(105)).toBe("succeeded");
    expect(historyLens).toEqual([0, 0]);
  });

  it("resumeFromEvents cursor continues at nextStateId and skips lastCompleted", async () => {
    process.env.FSM_MOCK_PROVIDER = "1";
    const store = createMemoryRunStore();
    store.statuses.set(106, "interrupted");
    await store.insertEvent(106, {
      stateId: "S1",
      kind: RUN_CURSOR_KIND,
      payload: serializeRunCursor("S1", {
        lastCompletedStateId: "S1",
        lastSignal: "::SCRIPT.NEXT",
        nextStateId: "S2",
        attempt: 1,
        payloadRef: JSON.stringify({ from: "S1" }),
      }).payload,
    });

    const supervisor = createRunSupervisor({
      store,
      loadRunDefinition: async () => ({
        json: JSON.stringify({
          states: [
            {
              id: "S0",
              type: "START",
              transitions: [{ on: "::SCRIPT.NEXT", to: "S1" }],
            },
            {
              id: "S1",
              type: "SCRIPT",
              transitions: [{ on: "::SCRIPT.NEXT", to: "S2" }],
            },
            {
              id: "S2",
              type: "SCRIPT",
              transitions: [{ on: "::SCRIPT.NEXT", to: "END" }],
            },
            { id: "END", type: "END" },
          ],
        }),
      }),
    });

    const result = await supervisor.resume(106);
    expect(result).toEqual({ ok: true });
    await supervisor.getActive(106)?.done;

    const started = store.events
      .filter((e) => e.kind === "state.start")
      .map((e) => e.stateId);
    expect(started).toContain("S2");
    expect(started).not.toContain("S0");
    expect(started).not.toContain("S1");
    expect(store.statuses.get(106)).toBe("succeeded");
    delete process.env.FSM_MOCK_PROVIDER;
  });

  it("resume while already running returns 409 ALREADY_RUNNING", async () => {
    const store = createMemoryRunStore();
    store.statuses.set(107, "running");
    const supervisor = createRunSupervisor({ store });
    const result = await supervisor.resume(107);
    expect(result).toEqual({
      ok: false,
      error: "ALREADY_RUNNING",
      status: 409,
    });
  });

  it("boot recover of interrupted runs resumes at nextStateId", async () => {
    process.env.FSM_MOCK_PROVIDER = "1";
    const store = createMemoryRunStore();
    store.statuses.set(108, "running");
    await store.insertEvent(108, {
      stateId: "S0",
      kind: RUN_CURSOR_KIND,
      payload: serializeRunCursor("S0", {
        lastCompletedStateId: "S0",
        lastSignal: "::SCRIPT.NEXT",
        nextStateId: "END",
        attempt: 1,
        payloadRef: "{}",
      }).payload,
    });

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

    const crashed = await store.listRunIdsByStatus!("running");
    expect(crashed).toEqual([108]);
    await store.markOrphanedRunning();
    expect(store.statuses.get(108)).toBe("interrupted");
    const n = await supervisor.resumeCrashedRuns(crashed);
    expect(n).toBe(1);
    await supervisor.getActive(108)?.done;
    const started = store.events
      .filter((e) => e.kind === "state.start")
      .map((e) => e.stateId);
    expect(started).not.toContain("S0");
    expect(store.statuses.get(108)).toBe("succeeded");
    delete process.env.FSM_MOCK_PROVIDER;
  });

  it("verify_fail does not retry unless retryOn includes verify_fail", async () => {
    const store = createMemoryRunStore();
    const supervisor = createRunSupervisor({ store });
    await supervisor.executeRun(109, {
      states: [
        {
          id: "S0",
          type: "START",
          guardrails: { timeoutMs: 5_000, retryMax: 1, retryBackoffMs: 0 },
        },
        {
          id: "V1",
          type: "VALIDATE",
          guardrails: {
            timeoutMs: 5_000,
            retryMax: 1,
            retryBackoffMs: 0,
            retryOn: ["timeout", "execute"],
          },
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

    expect(store.statuses.get(109)).toBe("failed");
    expect(
      store.events.some(
        (e) =>
          e.kind === "state.retry" &&
          (e.payload as { reason?: string })?.reason === "verify_fail"
      )
    ).toBe(false);
  });
});

describe("dropStateMemory helper (R5)", () => {
  it("clears history and keeps vars[stateId]", () => {
    const ctx = {
      vars: { S1: { ok: true } },
      payload: { ok: true },
      history: [{ role: "assistant" as const, content: "secret" }],
      toolLogs: ["log"],
      ledger: { runId: 1, totals: { tokensIn: 0, tokensOut: 0 }, byState: {} },
    };
    const next = dropStateMemory(ctx, { stateId: "S1" });
    expect(next.history).toEqual([]);
    expect(next.toolLogs).toEqual([]);
    expect(next.vars.S1).toEqual({ ok: true });
  });

  it("retainContext keeps history", () => {
    const ctx = {
      vars: { S1: { ok: true } },
      payload: { ok: true },
      history: [{ role: "assistant" as const, content: "keep" }],
      toolLogs: ["log"],
      ledger: { runId: 1, totals: { tokensIn: 0, tokensOut: 0 }, byState: {} },
    };
    const next = dropStateMemory(ctx, { stateId: "S1", retainContext: true });
    expect(next.history).toEqual([{ role: "assistant", content: "keep" }]);
  });
});
