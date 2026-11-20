import { describe, expect, it } from "vitest";
import { parseSignal } from "./signals";
import { resolveTransition } from "./resolver";
import { runState, type Clock } from "./run-state";
import { runSpawn, withInFlightProbe } from "./spawn-pool";
import { runFsm } from "./runner";

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
          // Deliberately malformed payload to exercise output-schema checks.
          return { signal: "::SCRIPT.NEXT", payload: "bad" as unknown as Record<string, unknown> };
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

describe("regressions (code-review fixes)", () => {
  const realClock: Clock = {
    now: () => Date.now(),
    sleep: (ms, signal) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error("aborted"));
        const t = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new Error("aborted"));
        });
      }),
  };

  it("runState enforces timeoutMs even when the executor ignores its signal", async () => {
    const r = await runState(
      {
        id: "S1",
        guardrails: { timeoutMs: 15, retryMax: 0, retryBackoffMs: 0 },
        onErrorSignal: "::SCRIPT.ERROR",
        execute: () => new Promise<never>(() => {}), // never settles
      },
      {},
      { clock: realClock }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("timeout");
  });

  it("runState returns reason=aborted (does not throw) on parent abort mid-execute", async () => {
    const parent = new AbortController();
    setTimeout(() => parent.abort(), 10);
    const r = await runState(
      {
        id: "S1",
        guardrails: { timeoutMs: 1000, retryMax: 3, retryBackoffMs: 50 },
        onErrorSignal: "::SCRIPT.ERROR",
        execute: ({ signal }) =>
          new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(new Error("stop")))
          ),
      },
      {},
      { clock: realClock, abortSignal: parent.signal }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("aborted");
    expect(r.attempts).toBe(1);
  });

  it("runSpawn labels pool-cancelled children 'cancelled', not 'timeout'", async () => {
    const envelopes = await runSpawn(
      {
        mode: "homogeneous",
        count: 3,
        maxConcurrency: 3,
        strategy: "firstSuccess",
        cancelOnParentHalt: true,
        profiles: [{ id: "default", toolPack: [], skillPack: [], timeoutMs: 5000 }],
      },
      async ({ index, signal }) => {
        if (index === 0) return { win: true };
        return new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("cancelled")))
        );
      }
    );
    expect(envelopes.map((e) => e.status)).toEqual(["ok", "cancelled", "cancelled"]);
  });

  it("runSpawn settles a child that ignores its signal (real timeout)", async () => {
    const envelopes = await runSpawn(
      {
        mode: "homogeneous",
        count: 1,
        maxConcurrency: 1,
        strategy: "waitAll",
        cancelOnParentHalt: true,
        profiles: [{ id: "default", toolPack: [], skillPack: [], timeoutMs: 15 }],
      },
      () => new Promise(() => {}) // hangs forever, ignores abort
    );
    expect(envelopes[0].status).toBe("timeout");
  });

  it("runSpawn with an already-aborted parent cancels everything", async () => {
    const parent = new AbortController();
    parent.abort();
    let ran = 0;
    const envelopes = await runSpawn(
      {
        mode: "homogeneous",
        count: 2,
        maxConcurrency: 2,
        strategy: "waitAll",
        cancelOnParentHalt: true,
        profiles: [{ id: "default", toolPack: [], skillPack: [] }],
      },
      async () => {
        ran += 1;
        return {};
      },
      { parentSignal: parent.signal }
    );
    expect(ran).toBe(0);
    expect(envelopes.every((e) => e.status === "cancelled")).toBe(true);
  });

  it("resolveTransition prefers flow edges over router wiring with the same signal", () => {
    const r = resolveTransition({
      fromStateId: "SF",
      emission: "::SYSTEM.HYDRATE",
      edges: [
        { from: "SF", on: "::SYSTEM.HYDRATE", to: "HEAD_TARGET", kind: "router" },
        { from: "SF", on: "::SYSTEM.HYDRATE", to: "NEXT", kind: "transition" },
      ],
    });
    expect(r.ok && r.to).toBe("NEXT");
  });

  it("runFsm stops with 'Run aborted' when the abort signal fires", async () => {
    const ctrl = new AbortController();
    const r = await runFsm({
      states: [
        { id: "S0", type: "START" },
        { id: "A", type: "SCRIPT" },
        { id: "E", type: "END" },
      ],
      edges: [
        { from: "S0", on: "::SCRIPT.NEXT", to: "A" },
        { from: "A", on: "::SCRIPT.NEXT", to: "E" },
      ],
      abortSignal: ctrl.signal,
      executeState: async ({ state }) => {
        if (state.id === "S0") ctrl.abort();
        return "::SCRIPT.NEXT";
      },
    });
    expect(r.status).toBe("failed");
    expect(r.error).toBe("Run aborted");
  });
});
