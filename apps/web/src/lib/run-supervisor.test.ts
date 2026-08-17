import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mockAdapter } from "@fsm/byok-gateway";
import type { StateNodeData } from "@/lib/fsm-types";
import { createAiExecutor } from "@/lib/executors/ai";
import { createHumanBridge } from "@/lib/executors/human-bridge";
import { createHumanExecutor } from "@/lib/executors/human";
import { getExecutor } from "@/lib/executors/registry";
import {
  createMemoryRunStore,
  createRunSupervisor,
  reconcileOrphanedRuns,
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

describe("run supervisor", () => {
  it("writes state.start before state.output in monotonic id order", async () => {
    const store = createMemoryRunStore();
    const supervisor = createRunSupervisor({ store });
    await supervisor.executeRun(1, START_END);

    const kinds = store.events.map((e) => e.kind);
    expect(kinds[0]).toBe("state.start");
    expect(kinds).toContain("state.output");
    expect(kinds.at(-1)).toBe("run.complete");

    const byState = (id: string) => store.events.filter((e) => e.stateId === id);
    const startEv = byState("S0");
    const startKinds = startEv.map((e) => e.kind);
    expect(startKinds.slice(0, 3)).toEqual([
      "state.start",
      "state.output",
      "state.transition",
    ]);
    const vKinds = byState("V1").map((e) => e.kind);
    expect(vKinds.slice(0, 3)).toEqual([
      "state.start",
      "state.output",
      "state.transition",
    ]);

    const ids = store.events.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
    expect(store.statuses.get(1)).toBe("succeeded");
  });

  it("cancel() aborts an in-flight executor and ends the run as cancelled", async () => {
    const store = createMemoryRunStore();
    const supervisor = createRunSupervisor({ store });
    let releaseStarted!: () => void;
    const started = new Promise<void>((r) => {
      releaseStarted = r;
    });

    const { done } = supervisor.beginRun(7, {
      states: [
        {
          id: "S0",
          type: "START",
          guardrails: { timeoutMs: 30_000, retryMax: 0, retryBackoffMs: 0 },
        },
        { id: "END", type: "END" },
      ],
      edges: [{ from: "S0", on: "::SCRIPT.NEXT", to: "END" }],
      executeState: async ({ signal }) => {
        releaseStarted();
        await new Promise<never>((_, reject) => {
          if (signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
        return "::SCRIPT.NEXT";
      },
    });

    await started;
    expect(supervisor.cancel(7)).toBe(true);
    await done;
    expect(store.statuses.get(7)).toBe("cancelled");
    expect(store.events.some((e) => e.kind === "run.failed")).toBe(true);
  });

  it("boot reconciliation flips orphaned running rows to interrupted", async () => {
    const store = createMemoryRunStore();
    store.statuses.set(3, "running");
    store.statuses.set(4, "succeeded");
    store.statuses.set(5, "awaiting_human");
    const n = await reconcileOrphanedRuns(store);
    expect(n).toBe(1);
    expect(store.statuses.get(3)).toBe("interrupted");
    expect(store.statuses.get(4)).toBe("succeeded");
    expect(store.statuses.get(5)).toBe("awaiting_human");
  });

  it("never persists an apiKey in event payloads", async () => {
    for (let i = 0; i < 10; i++) {
      const planted = `sk-${randomBytes(18).toString("hex")}`;
      const store = createMemoryRunStore();
      const executeAi = createAiExecutor({
        isMock: () => false,
        getCredential: async () => ({
          key: planted,
          provider: "openai",
          baseUrl: null,
        }),
        adapter: mockAdapter,
      });
      const supervisor = createRunSupervisor({
        store,
        getExecutor: (type) => (type === "AI" ? executeAi : getExecutor(type)),
      });
      await supervisor.executeRun(10 + i, {
        states: [
          { id: "S0", type: "START" },
          { id: "AI1", type: "AI" },
          { id: "END", type: "END" },
        ],
        edges: [
          { from: "S0", on: "::SCRIPT.NEXT", to: "AI1" },
          { from: "AI1", on: "::AI.NEXT", to: "END" },
        ],
        nodesById: new Map([
          [
            "AI1",
            {
              id: "AI1",
              data: {
                ai: {
                  credentialId: "1",
                  model: "mock-chat",
                  temperature: 0,
                  maxTokens: 32,
                  systemPrompt: "",
                  outputSchema: "",
                },
              } as StateNodeData,
            },
          ],
        ]),
      });
      expect(store.statuses.get(10 + i)).toBe("succeeded");
      for (const ev of store.events) {
        const blob = JSON.stringify(ev);
        expect(blob).not.toContain(planted);
        expect(blob).not.toMatch(/"apiKey"/);
      }
    }
  });

  it("human task resolution resumes the run with the approval signal", async () => {
    const store = createMemoryRunStore();
    const bridge = createHumanBridge();
    const executeHuman = createHumanExecutor({
      createTask: async () => ({ id: 42 }),
      setRunAwaiting: async (runId) => {
        await store.updateRun(runId, { status: "awaiting_human" });
      },
      wait: (args) => bridge.wait(args),
    });
    const supervisor = createRunSupervisor({
      store,
      humanBridge: bridge,
      getExecutor: (type) =>
        type === "HUMAN" ? executeHuman : getExecutor(type),
    });

    const { done } = supervisor.beginRun(21, {
      states: [
        {
          id: "S0",
          type: "START",
          guardrails: { timeoutMs: 5_000, retryMax: 0, retryBackoffMs: 0 },
        },
        {
          id: "H1",
          type: "HUMAN",
          guardrails: { timeoutMs: 5_000, retryMax: 0, retryBackoffMs: 0 },
        },
        { id: "END", type: "END" },
      ],
      edges: [
        { from: "S0", on: "::SCRIPT.NEXT", to: "H1" },
        { from: "H1", on: "::HUMAN.APPROVE", to: "END" },
      ],
      nodesById: new Map([
        [
          "H1",
          {
            id: "H1",
            data: {
              human: {
                prompt: "Approve deploy?",
                approvalSignals: ["::HUMAN.APPROVE"],
              },
            } as StateNodeData,
          },
        ],
      ]),
    });

    const startWait = Date.now();
    while (store.statuses.get(21) !== "awaiting_human") {
      if (Date.now() - startWait > 2_000) {
        throw new Error("did not reach awaiting_human");
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    const awaiting = store.events.find((e) => e.kind === "human.awaiting");
    const taskId = Number(
      (awaiting?.payload as { taskId?: number } | null)?.taskId
    );
    expect(taskId).toBe(42);

    const woke = await supervisor.resumeHuman(21, taskId, {
      signal: "::HUMAN.APPROVE",
      decision: "approved",
    });
    expect(woke).toBe(true);
    await done;

    expect(store.statuses.get(21)).toBe("succeeded");
    const output = store.events.find(
      (e) => e.kind === "state.output" && e.stateId === "H1"
    );
    expect(output?.payload).toMatchObject({ signal: "::HUMAN.APPROVE" });
    expect(store.events.some((e) => e.kind === "human.resolved")).toBe(true);
    expect(store.events.some((e) => e.kind === "run.complete")).toBe(true);
  });

  it("human task expiry emits ::HUMAN.REJECT", async () => {
    const store = createMemoryRunStore();
    const bridge = createHumanBridge();
    let expired = false;
    const executeHuman = createHumanExecutor({
      createTask: async () => ({ id: 7 }),
      setRunAwaiting: async (runId) => {
        await store.updateRun(runId, { status: "awaiting_human" });
      },
      wait: (args) => bridge.wait(args),
      expireTask: async () => {
        expired = true;
      },
    });
    const supervisor = createRunSupervisor({
      store,
      humanBridge: bridge,
      getExecutor: (type) =>
        type === "HUMAN" ? executeHuman : getExecutor(type),
    });

    await supervisor.executeRun(22, {
      states: [
        {
          id: "S0",
          type: "START",
          guardrails: { timeoutMs: 5_000, retryMax: 0, retryBackoffMs: 0 },
        },
        {
          id: "H1",
          type: "HUMAN",
          guardrails: { timeoutMs: 5_000, retryMax: 0, retryBackoffMs: 0 },
        },
        { id: "END", type: "END" },
      ],
      edges: [
        { from: "S0", on: "::SCRIPT.NEXT", to: "H1" },
        { from: "H1", on: "::HUMAN.REJECT", to: "END" },
      ],
      nodesById: new Map([
        [
          "H1",
          {
            id: "H1",
            data: {
              human: {
                prompt: "Approve quickly",
                approvalSignals: ["::HUMAN.APPROVE", "::HUMAN.REJECT"],
                timeoutMs: 25,
              },
            } as StateNodeData,
          },
        ],
      ]),
    });

    expect(expired).toBe(true);
    const output = store.events.find(
      (e) => e.kind === "state.output" && e.stateId === "H1"
    );
    expect(output?.payload).toMatchObject({ signal: "::HUMAN.REJECT" });
    const resolved = store.events.find((e) => e.kind === "human.resolved");
    expect(resolved?.payload).toMatchObject({
      decision: "expired",
      signal: "::HUMAN.REJECT",
    });
    expect(store.statuses.get(22)).toBe("succeeded");
  });
});
