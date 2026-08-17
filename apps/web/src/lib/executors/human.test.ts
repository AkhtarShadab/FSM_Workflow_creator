import { describe, expect, it } from "vitest";
import type { StateNodeData } from "@/lib/fsm-types";
import { createHumanBridge } from "./human-bridge";
import { createHumanExecutor, type StoredHumanTask } from "./human";
import type { RunEventDraft } from "./types";

function humanNode(partial: Partial<StateNodeData["human"]> = {}): {
  id: string;
  data: StateNodeData;
} {
  return {
    id: "H1",
    data: {
      human: {
        prompt: "Ship it?",
        approvalSignals: ["::HUMAN.APPROVE", "::HUMAN.REJECT"],
        timeoutMs: 5_000,
        ...partial,
      },
    } as StateNodeData,
  };
}

async function waitUntil(pred: () => boolean, ms = 2_000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("HUMAN executor", () => {
  it("inserts a task, emits human.awaiting, then resumes with ::HUMAN.APPROVE", async () => {
    const bridge = createHumanBridge();
    const tasks = new Map<number, StoredHumanTask & { prompt: string }>();
    let awaiting = false;
    const execute = createHumanExecutor({
      createTask: async (input) => {
        tasks.set(1, { id: 1, status: "pending", prompt: input.prompt });
        return { id: 1 };
      },
      setRunAwaiting: async () => {
        awaiting = true;
      },
      wait: (args) => bridge.wait(args),
    });

    const drafts: RunEventDraft[] = [];
    const pending = execute({
      runId: 9,
      state: { id: "H1", type: "HUMAN" },
      node: humanNode(),
      payload: { item: 3 },
      signal: new AbortController().signal,
      emit: async (ev) => {
        drafts.push(ev);
      },
    });

    await waitUntil(() => awaiting && drafts.some((d) => d.kind === "human.awaiting"));
    expect(tasks.get(1)?.status).toBe("pending");
    expect(drafts[0]).toMatchObject({
      kind: "human.awaiting",
      payload: { taskId: 1, prompt: "Ship it?" },
    });

    expect(bridge.resolve(9, 1, { signal: "::HUMAN.APPROVE", decision: "approved" })).toBe(
      true
    );
    const emission = await pending;
    expect(emission).toMatchObject({
      signal: "::HUMAN.APPROVE",
      payload: { item: 3, human: { decision: "approved" } },
    });
    expect(drafts.map((d) => d.kind)).toEqual(["human.awaiting", "human.resolved"]);
  });

  it("expiry emits ::HUMAN.REJECT and marks the task expired", async () => {
    const bridge = createHumanBridge();
    let expired = false;
    const execute = createHumanExecutor({
      createTask: async () => ({ id: 4 }),
      setRunAwaiting: async () => undefined,
      wait: (args) => bridge.wait(args),
      expireTask: async () => {
        expired = true;
      },
      now: () => Date.now(),
    });

    const drafts: RunEventDraft[] = [];
    const emission = await execute({
      runId: 2,
      state: { id: "H1", type: "HUMAN" },
      node: humanNode({ timeoutMs: 20 }),
      payload: {},
      signal: new AbortController().signal,
      emit: async (ev) => {
        drafts.push(ev);
      },
    });

    expect(emission).toMatchObject({
      signal: "::HUMAN.REJECT",
      payload: { human: { decision: "expired" } },
    });
    expect(expired).toBe(true);
    expect(drafts.at(-1)).toMatchObject({
      kind: "human.resolved",
      payload: { decision: "expired", signal: "::HUMAN.REJECT" },
    });
  });

  it("returns the stored signal when the task is already resolved", async () => {
    const execute = createHumanExecutor({
      createTask: async () => ({ id: 8 }),
      findTask: async () => ({
        id: 8,
        status: "approved",
        responseJson: '{"note":"ok"}',
      }),
      setRunAwaiting: async () => {
        throw new Error("should not await an already-resolved task");
      },
      wait: async () => {
        throw new Error("should not wait");
      },
    });
    const emission = await execute({
      runId: 3,
      state: { id: "H1", type: "HUMAN" },
      node: humanNode(),
      payload: {},
      signal: new AbortController().signal,
      emit: async () => undefined,
    });
    expect(emission).toMatchObject({
      signal: "::HUMAN.APPROVE",
      payload: { human: { decision: "approved", response: { note: "ok" } } },
    });
  });
});
