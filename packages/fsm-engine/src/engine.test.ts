import { describe, expect, it } from "vitest";
import { parseSignal } from "./signals";
import { resolveTransition } from "./resolver";
import { runState, type Clock } from "./run-state";
import { runSpawn, withInFlightProbe } from "./spawn-pool";

describe("parseSignal", () => {
  it("parses string grammar with payload", () => {
    const p = parseSignal('::SCRIPT.NEXT|message="pages=12"|toHint=END');
    expect(p.signal).toBe("::SCRIPT.NEXT");
    expect(p.payload.message).toBe("pages=12");
    expect(p.toHint).toBe("END");
  });

  it("accepts structured emission", () => {
    const p = parseSignal({
      signal: "::AI.NEXT",
      payload: { x: 1 },
      toHint: "S2",
    });
    expect(p.signal).toBe("::AI.NEXT");
    expect(p.payload).toEqual({ x: 1 });
    expect(p.toHint).toBe("S2");
  });
});

describe("resolveTransition", () => {
  const edges = [
    { from: "A", on: "::SCRIPT.NEXT", to: "B" },
    { from: "A", on: "::SCRIPT.NEXT", to: "C" },
    { from: "A", on: "::SCRIPT.ERROR", to: "ERR" },
    { from: "B", on: "::SCRIPT.NEXT", to: "END" },
    { from: "C", on: "::SCRIPT.NEXT", to: "END" },
  ];

  it("matches signal to edge", () => {
    const r = resolveTransition({
      fromStateId: "A",
      emission: "::SCRIPT.ERROR",
      edges,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("ERR");
  });

  it("halts when no matching edge", () => {
    const r = resolveTransition({
      fromStateId: "A",
      emission: "::AI.NEXT",
      edges,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("transition_error");
  });

  it("accepts toHint in allowlist", () => {
    const r = resolveTransition({
      fromStateId: "A",
      emission: { signal: "::SCRIPT.NEXT", toHint: "C" },
      edges,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("C");
  });

  it("rejects toHint outside allowlist", () => {
    const r = resolveTransition({
      fromStateId: "A",
      emission: { signal: "::SCRIPT.NEXT", toHint: "END" },
      edges,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("toHint_mismatch");
  });

  it("skips disabled target to next enabled successor", () => {
    const r = resolveTransition({
      fromStateId: "A",
      emission: "::SCRIPT.NEXT",
      edges: [
        { from: "A", on: "::SCRIPT.NEXT", to: "B" },
        { from: "B", on: "::SCRIPT.NEXT", to: "END" },
      ],
      mask: {
        enabledStateIds: [],
        disabledStateIds: ["B"],
        rewire: [],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("END");
  });

  it("rewire override wins", () => {
    const r = resolveTransition({
      fromStateId: "A",
      emission: "::SCRIPT.NEXT",
      edges: [{ from: "A", on: "::SCRIPT.NEXT", to: "B" }],
      mask: {
        enabledStateIds: [],
        disabledStateIds: [],
        rewire: [{ from: "A", on: "::SCRIPT.NEXT", to: "END" }],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("END");
  });

  it("disabled wins over enabled list", () => {
    const r = resolveTransition({
      fromStateId: "A",
      emission: "::SCRIPT.NEXT",
      edges: [
        { from: "A", on: "::SCRIPT.NEXT", to: "B" },
        { from: "B", on: "::SCRIPT.NEXT", to: "END" },
      ],
      mask: {
        enabledStateIds: ["A", "B", "END"],
        disabledStateIds: ["B"],
        rewire: [],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("END");
  });
});

describe("runState", () => {
  const clock: Clock = {
    now: () => 0,
    sleep: async () => undefined,
  };

  it("fails input schema without executing", async () => {
    let ran = false;
    const r = await runState(
      {
        id: "S1",
        inputSchema: { type: "object" },
        guardrails: { timeoutMs: 1000, retryMax: 2, retryBackoffMs: 1 },
        onErrorSignal: "::SCRIPT.ERROR",
        execute: async () => {
          ran = true;
          return "::SCRIPT.NEXT";
        },
      },
      "not-an-object",
      { clock }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("input_schema");
    expect(ran).toBe(false);
  });

  it("retries on output schema failure then errors", async () => {
    let attempts = 0;
    const r = await runState(
      {
        id: "S1",
        outputSchema: { type: "object" },
        guardrails: { timeoutMs: 1000, retryMax: 2, retryBackoffMs: 1 },
        onErrorSignal: "::SCRIPT.ERROR",
        execute: async () => {
          attempts += 1;
          return { signal: "::SCRIPT.NEXT", payload: "bad" };
        },
      },
      {},
      { clock }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("output_schema");
    expect(attempts).toBe(3);
  });

  it("times out and retries", async () => {
    const r = await runState(
      {
        id: "S1",
        guardrails: { timeoutMs: 20, retryMax: 1, retryBackoffMs: 1 },
        onErrorSignal: "::SCRIPT.ERROR",
        execute: async ({ signal }) =>
          new Promise((_, reject) => {
            signal.addEventListener("abort", () =>
              reject(new Error("aborted"))
            );
          }),
      },
      {},
      { clock }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("timeout");
    expect(r.attempts).toBe(2);
  });
});

describe("runSpawn", () => {
  it("never exceeds maxConcurrency", async () => {
    const probe = withInFlightProbe(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true };
    });
    const envelopes = await runSpawn(
      {
        mode: "homogeneous",
        count: 5,
        maxConcurrency: 2,
        strategy: "waitAll",
        cancelOnParentHalt: true,
        profiles: [{ id: "default", toolPack: ["a"], skillPack: [] }],
      },
      probe.execute
    );
    expect(envelopes).toHaveLength(5);
    expect(probe.peak()).toBeLessThanOrEqual(2);
    expect(envelopes.every((e) => e.status === "ok")).toBe(true);
  });

  it("firstSuccess cancels remaining", async () => {
    const envelopes = await runSpawn(
      {
        mode: "homogeneous",
        count: 4,
        maxConcurrency: 2,
        strategy: "firstSuccess",
        cancelOnParentHalt: true,
        profiles: [{ id: "default", toolPack: [], skillPack: [] }],
      },
      async ({ index, signal }) => {
        if (index === 0) return { win: true };
        await new Promise((r, j) => {
          signal.addEventListener("abort", () => j(new Error("cancelled")));
          setTimeout(r, 200);
        });
        return {};
      }
    );
    expect(envelopes.some((e) => e.status === "ok")).toBe(true);
    expect(envelopes.some((e) => e.status === "cancelled")).toBe(true);
  });

  it("quorum keeps error envelopes", async () => {
    const envelopes = await runSpawn(
      {
        mode: "homogeneous",
        count: 3,
        maxConcurrency: 3,
        strategy: "quorum",
        quorumK: 2,
        cancelOnParentHalt: true,
        profiles: [{ id: "default", toolPack: [], skillPack: [] }],
      },
      async ({ index }) => {
        if (index === 0) throw new Error("boom");
        await new Promise((r) => setTimeout(r, 15));
        return { i: index };
      }
    );
    expect(envelopes).toHaveLength(3);
    const oks = envelopes.filter((e) => e.status === "ok");
    const errors = envelopes.filter((e) => e.status === "error");
    expect(oks.length).toBeGreaterThanOrEqual(2);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.error).toContain("boom");
  });

  it("routes heterogeneous tool/skill packs", async () => {
    const seen: Array<{ toolPack: string[]; skillPack: string[] }> = [];
    await runSpawn(
      {
        mode: "heterogeneous",
        count: 2,
        maxConcurrency: 2,
        strategy: "waitAll",
        cancelOnParentHalt: true,
        profiles: [
          { id: "p0", toolPack: ["t0"], skillPack: ["s0"] },
          { id: "p1", toolPack: ["t1"], skillPack: ["s1"] },
        ],
      },
      async (ctx) => {
        seen.push({ toolPack: ctx.toolPack, skillPack: ctx.skillPack });
        return {};
      }
    );
    expect(seen).toEqual([
      { toolPack: ["t0"], skillPack: ["s0"] },
      { toolPack: ["t1"], skillPack: ["s1"] },
    ]);
  });

  it("parent abort with cancelOnParentHalt cancels in-flight", async () => {
    const parent = new AbortController();
    const p = runSpawn(
      {
        mode: "homogeneous",
        count: 3,
        maxConcurrency: 2,
        strategy: "waitAll",
        cancelOnParentHalt: true,
        profiles: [{ id: "default", toolPack: [], skillPack: [] }],
      },
      async ({ signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")));
          setTimeout(() => resolve({}), 500);
        }),
      { parentSignal: parent.signal }
    );
    setTimeout(() => parent.abort(), 20);
    const envelopes = await p;
    expect(envelopes.some((e) => e.status === "cancelled")).toBe(true);
  });
});
