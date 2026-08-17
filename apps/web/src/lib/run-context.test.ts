import { describe, expect, it } from "vitest";
import { dropStateMemory, type RunContext } from "./run-context";

function baseContext(): RunContext {
  return {
    vars: {
      S1: { result: "kept" },
      S0: { bootstrap: true },
    },
    payload: { last: "output" },
    history: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ],
    toolLogs: ["tool:fetch_pages ok"],
    phaseMap: {
      clusters: [{ id: "c1", label: "Cluster", summary: "s", stateCount: 2 }],
    },
    ledger: {
      runId: 9,
      totals: { tokensIn: 100, tokensOut: 50 },
      byState: { S1: { tokensIn: 80, tokensOut: 40 } },
    },
  };
}

describe("R5 dropStateMemory", () => {
  it("clears history and toolLogs but keeps vars[stateId] and payload", () => {
    const ctx = baseContext();
    const next = dropStateMemory(ctx, { stateId: "S1" });
    expect(next.history).toEqual([]);
    expect(next.toolLogs).toEqual([]);
    expect(next.vars.S1).toEqual({ result: "kept" });
    expect(next.payload).toEqual({ last: "output" });
  });

  it("retainContext keeps history and toolLogs", () => {
    const ctx = baseContext();
    const next = dropStateMemory(ctx, { stateId: "S1", retainContext: true });
    expect(next.history).toEqual(ctx.history);
    expect(next.toolLogs).toEqual(ctx.toolLogs);
  });

  it("does not wipe phaseMap or ledger (SYS_FUNC caller skips)", () => {
    const ctx = baseContext();
    const next = dropStateMemory(ctx, { stateId: "S1" });
    expect(next.phaseMap).toEqual(ctx.phaseMap);
    expect(next.ledger).toEqual(ctx.ledger);
  });
});
