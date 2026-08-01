import { describe, expect, it } from "vitest";
import { canvasToDsl, lintCanvas } from "./canvas-to-dsl";
import {
  defaultNodeData,
  defaultSpawnConfig,
  normalizeSpawn,
  type CanvasData,
  type StateNode,
  type TransitionEdge,
} from "./fsm-types";

function node(
  id: string,
  type: StateNode["data"]["stateType"],
  patch: Partial<StateNode["data"]> = {}
): StateNode {
  return {
    id,
    type: "stateCircle",
    position: { x: 0, y: 0 },
    data: { ...defaultNodeData(type, type), ...patch, stateType: type },
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  signal: string
): TransitionEdge {
  return {
    id,
    source,
    target,
    type: "script",
    data: { signal },
    label: signal,
  };
}

describe("normalizeSpawn", () => {
  it("upgrades legacy { childFsm, count, strategy } to v2", () => {
    const spawn = normalizeSpawn({
      childFsm: "worker-a",
      count: 5,
      strategy: "firstSuccess",
    });
    expect(spawn.count).toBe(5);
    expect(spawn.strategy).toBe("firstSuccess");
    expect(spawn.maxConcurrency).toBeGreaterThanOrEqual(1);
    expect(spawn.profiles[0]?.childFsm).toBe("worker-a");
    expect(spawn.profiles[0]?.toolPack).toEqual([]);
  });

  it("clamps maxConcurrency to at least 1", () => {
    const spawn = normalizeSpawn({ ...defaultSpawnConfig(), maxConcurrency: 0 });
    expect(spawn.maxConcurrency).toBe(1);
  });
});

describe("canvasToDsl spawn v2", () => {
  it("emits maxConcurrency, profiles, and verifiability fields", () => {
    const spawn = defaultSpawnConfig();
    spawn.maxConcurrency = 2;
    spawn.count = 3;
    spawn.profiles = [
      {
        id: "default",
        childFsm: "child-worker",
        toolPack: ["fetch_pages"],
        skillPack: ["ship-feature"],
        modelId: "gpt-4o-mini",
      },
    ];
    spawn.aggregateTo = "AGG_1";

    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("SP1", "SPAWN", {
          label: "FanOut",
          spawn,
          inputSchema: '{"type":"object"}',
          onError: { signal: "::SCRIPT.ERROR" },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "SP1", "::SCRIPT.NEXT"),
        edge("e2", "SP1", "END", "::SPAWN.SUBAGENTS"),
      ],
    };

    const dsl = canvasToDsl(canvas, { name: "spawn-test" });
    const spawnState = dsl.states.find((s: { id: string }) => s.id === "SP1") as {
      spawn: {
        maxConcurrency: number;
        profiles: Array<{ toolPack: string[]; skillPack: string[] }>;
        aggregateTo: string;
      };
      verify: { kind: string };
      onError: { signal: string };
      inputSchema: unknown;
    };

    expect(dsl.name).toBe("spawn-test");
    expect(spawnState.spawn.maxConcurrency).toBe(2);
    expect(spawnState.spawn.aggregateTo).toBe("AGG_1");
    expect(spawnState.spawn.profiles[0].toolPack).toEqual(["fetch_pages"]);
    expect(spawnState.spawn.profiles[0].skillPack).toEqual(["ship-feature"]);
    expect(spawnState.verify.kind).toBe("schema");
    expect(spawnState.onError.signal).toBe("::SCRIPT.ERROR");
    expect(spawnState.inputSchema).toEqual({ type: "object" });
  });

  it("emits AI credentialId when set", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("AI1", "AI", {
          ai: {
            ...defaultNodeData("AI", "AI").ai,
            credentialId: "cred_1",
            model: "gpt-4o",
          },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "AI1", "::SCRIPT.NEXT"),
        edge("e2", "AI1", "END", "::AI.NEXT"),
      ],
    };
    const dsl = canvasToDsl(canvas);
    const ai = dsl.states.find((s: { id: string }) => s.id === "AI1") as {
      llm: { credentialId?: string; model: string };
    };
    expect(ai.llm.credentialId).toBe("cred_1");
    expect(ai.llm.model).toBe("gpt-4o");
  });
});

describe("lintCanvas C1", () => {
  it("warns when SPAWN has empty tool pack", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("SP1", "SPAWN", { label: "FanOut" }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "SP1", "::SCRIPT.NEXT"),
        edge("e2", "SP1", "END", "::SPAWN.SUBAGENTS"),
        edge("e3", "SP1", "END", "::SCRIPT.ERROR"),
      ],
    };
    const warnings = lintCanvas(canvas);
    expect(warnings.some((w) => w.includes("empty tool pack"))).toBe(true);
  });

  it("warns when runnable state lacks error edge", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("SC1", "SCRIPT", { label: "Fetch" }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "SC1", "::SCRIPT.NEXT"),
        edge("e2", "SC1", "END", "::SCRIPT.NEXT"),
      ],
    };
    const warnings = lintCanvas(canvas);
    expect(warnings.some((w) => w.includes("no error-routing edge"))).toBe(true);
  });

  it("warns on heterogeneous profile/count mismatch", () => {
    const spawn = defaultSpawnConfig();
    spawn.mode = "heterogeneous";
    spawn.count = 3;
    spawn.profiles = [spawn.profiles[0]];
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("SP1", "SPAWN", { label: "FanOut", spawn }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "SP1", "::SCRIPT.NEXT"),
        edge("e2", "SP1", "END", "::SPAWN.SUBAGENTS"),
        edge("e3", "SP1", "END", "::SCRIPT.ERROR"),
      ],
    };
    const warnings = lintCanvas(canvas);
    expect(
      warnings.some((w) => w.includes("heterogeneous mode requires profiles.length"))
    ).toBe(true);
  });
});
