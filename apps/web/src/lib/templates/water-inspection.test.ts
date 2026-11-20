import { describe, expect, it } from "vitest";
import { runFsm } from "@fsm/engine";
import { canvasToDsl, lintCanvas } from "@/lib/canvas-to-dsl";
import { canvasToEngine } from "@/lib/canvas-to-engine";
import { emptyRegistry, registerSignal, registerSkill } from "@/lib/registry";
import { createStubExecutor, parseOverrides } from "@/lib/stub-executor";
import { detectTemplate } from "./index";
import { waterInspectionTemplate as tpl } from "./water-inspection";

function registryForTemplate() {
  let r = emptyRegistry();
  for (const s of tpl.registry.signals) r = registerSignal(r, s.signal, s.description);
  for (const s of tpl.registry.skills) r = registerSkill(r, s);
  return r;
}

async function run(overrides: Record<string, string[]>) {
  const { states, edges } = canvasToEngine(tpl.build());
  return runFsm({
    states,
    edges,
    executeState: createStubExecutor(overrides),
    executeChild: async () => ({ stub: true }),
  });
}

function path(events: Array<{ stateId: string; message: string }>) {
  return events.filter((e) => e.message.startsWith("enter ")).map((e) => e.stateId);
}

describe("water inspection template", () => {
  it("lints with zero errors and zero warnings once its registry is loaded", () => {
    const issues = lintCanvas(tpl.build(), { registry: registryForTemplate() });
    expect(issues).toEqual([]);
  });

  it("errors on its custom signal / skills when the registry is missing", () => {
    const codes = lintCanvas(tpl.build()).map((i) => i.code);
    expect(codes).toContain("UNKNOWN_SIGNAL");
    expect(codes).toContain("SPAWN_UNKNOWN_SKILL");
  });

  it("builds an independent copy each time", () => {
    const a = tpl.build();
    a.nodes[0].data.label = "mutated";
    expect(tpl.build().nodes[0].data.label).not.toBe("mutated");
  });

  it("is detected from its state ids", () => {
    expect(detectTemplate(tpl.build())?.id).toBe(tpl.id);
    expect(detectTemplate({ nodes: [], edges: [] })).toBeUndefined();
  });

  it("produces a DSL with all 14 states and the heterogeneous spawn", () => {
    const dsl = canvasToDsl(tpl.build(), { name: "demo" });
    expect(dsl.states).toHaveLength(14);
    const spawn = dsl.states.find((s) => s.id === "wi_spawn") as unknown as {
      spawn: { mode: string; profiles: unknown[]; aggregateTo: string };
    };
    expect(spawn.spawn.mode).toBe("heterogeneous");
    expect(spawn.spawn.profiles).toHaveLength(3);
    expect(spawn.spawn.aggregateTo).toBe("wi_merge");
  });

  for (const scenario of tpl.scenarios) {
    it(`scenario "${scenario.name}" ends as expected`, async () => {
      const result = await run(scenario.overrides);
      expect(result.status, result.error).toBe(scenario.expect.status);
      if (scenario.expect.finalStateId) {
        expect(result.finalStateId).toBe(scenario.expect.finalStateId);
      }
      if (scenario.expect.errorIncludes) {
        expect(result.error).toContain(scenario.expect.errorIncludes);
      }
      // every scenario fans out to the three specialist inspectors
      if (!scenario.overrides.wi_validate) {
        expect(result.aggregate?.map((e) => e.profileId)).toEqual([
          "defects",
          "leaks",
          "quality",
        ]);
      }
    });
  }

  it("re-triages after the supervisor sends it back", async () => {
    const s = tpl.scenarios.find((x) => x.id === "sent-back")!;
    const p = path((await run(s.overrides)).events);
    expect(p.filter((id) => id === "wi_triage")).toHaveLength(2);
    expect(p.filter((id) => id === "wi_review")).toHaveLength(2);
    expect(p.at(-1)).toBe("wi_done");
  });

  it("routine path never asks a human", async () => {
    const p = path((await run({})).events);
    expect(p).not.toContain("wi_review");
    expect(p).toEqual([
      "wi_start",
      "wi_fetch",
      "wi_validate",
      "wi_spawn",
      "wi_merge",
      "wi_checkpoint",
      "wi_triage",
      "wi_schedule",
      "wi_notify",
      "wi_done",
    ]);
  });
});

describe("parseOverrides", () => {
  it("accepts stateId → signal arrays and rejects junk", () => {
    expect(parseOverrides(undefined)).toEqual({});
    expect(parseOverrides({ a: ["::X.Y"] })).toEqual({ a: ["::X.Y"] });
    expect(parseOverrides({ a: "::X.Y" })).toBeNull();
    expect(parseOverrides({ a: ["no-prefix"] })).toBeNull();
    expect(parseOverrides([["::X.Y"]])).toBeNull();
  });
});
