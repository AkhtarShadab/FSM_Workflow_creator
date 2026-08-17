import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mockAdapter } from "@fsm/byok-gateway";
import { defaultNodeData, type StateNodeData } from "@/lib/fsm-types";
import { createAiExecutor } from "@/lib/executors/ai";
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
    const n = await reconcileOrphanedRuns(store);
    expect(n).toBe(1);
    expect(store.statuses.get(3)).toBe("interrupted");
    expect(store.statuses.get(4)).toBe("succeeded");
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

  it("prepends the phase map to the first AI system prompt only", async () => {
    const store = createMemoryRunStore();
    const prompts: string[] = [];
    const maps: Array<{ estimatedTokens: number } | undefined> = [];
    const supervisor = createRunSupervisor({
      store,
      getExecutor: (type) => async (ctx) => {
        if (type === "AI") {
          prompts.push(ctx.node?.data.ai.systemPrompt ?? "");
          maps.push(ctx.phaseMap);
          return "::AI.NEXT";
        }
        return getExecutor(type)(ctx);
      },
    });
    const ai1 = defaultNodeData("AI", "First");
    ai1.ai.systemPrompt = "You are helpful.";
    const ai2 = defaultNodeData("AI", "Second");
    ai2.ai.systemPrompt = "Second brain.";
    await supervisor.executeRun(42, {
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
      nodesById: new Map([
        ["AI1", { id: "AI1", data: ai1 }],
        ["AI2", { id: "AI2", data: ai2 }],
      ]),
    });
    expect(store.statuses.get(42)).toBe("succeeded");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("Phase map:");
    expect(prompts[0]).toContain("You are helpful.");
    expect(prompts[1]).toBe("Second brain.");
    expect(prompts[1]).not.toContain("Phase map:");
    expect(maps[0]?.estimatedTokens).toBeGreaterThan(0);
    expect(maps[0]?.estimatedTokens).toBeLessThanOrEqual(400);
    expect(maps[1]).toBe(maps[0]);
  });
});
