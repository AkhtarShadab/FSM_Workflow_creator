import { describe, expect, it } from "vitest";
import {
  emptyRegistry,
  exportRegistryBundle,
  isKnownSignal,
  isKnownSkill,
  isValidSignalNamespace,
  registerSignal,
  registerSkill,
} from "./registry";
import { lintCanvas } from "./canvas-to-dsl";
import {
  defaultNodeData,
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

describe("registry", () => {
  it("validates signal namespaces", () => {
    expect(isValidSignalNamespace("::MYAPP.DONE")).toBe(true);
    expect(isValidSignalNamespace("::bad")).toBe(false);
  });

  it("registers signals and skills", () => {
    let r = emptyRegistry();
    r = registerSignal(r, "::MYAPP.DONE");
    r = registerSkill(r, "ship-feature");
    expect(isKnownSignal("::MYAPP.DONE", r)).toBe(true);
    expect(isKnownSkill("ship-feature", r)).toBe(true);
    expect(exportRegistryBundle(r)).toContain("MYAPP.DONE");
  });

  it("lints unknown edge signals", () => {
    const canvas: CanvasData = {
      nodes: [node("S0", "START"), node("END", "END")],
      edges: [edge("e1", "S0", "END", "::NOPE.X")],
    };
    const issues = lintCanvas(canvas, { registry: emptyRegistry() });
    expect(issues.some((i) => i.code === "UNKNOWN_SIGNAL")).toBe(true);
  });

  it("accepts registered custom signals", () => {
    const registry = registerSignal(emptyRegistry(), "::MYAPP.DONE");
    const canvas: CanvasData = {
      nodes: [node("S0", "START"), node("END", "END")],
      edges: [edge("e1", "S0", "END", "::MYAPP.DONE")],
    };
    const issues = lintCanvas(canvas, { registry });
    expect(issues.some((i) => i.code === "UNKNOWN_SIGNAL")).toBe(false);
  });

  it("lints unknown SPAWN skill refs", () => {
    const spawn = defaultNodeData("SPAWN", "Fan").spawn;
    spawn.profiles[0].skillPack = ["missing-skill"];
    spawn.profiles[0].toolPack = ["t"];
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("SP1", "SPAWN", { label: "Fan", spawn }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "SP1", "::SCRIPT.NEXT"),
        edge("e2", "SP1", "END", "::SPAWN.SUBAGENTS"),
        edge("e3", "SP1", "END", "::SCRIPT.ERROR"),
      ],
    };
    const issues = lintCanvas(canvas, { registry: emptyRegistry() });
    expect(issues.some((i) => i.code === "SPAWN_UNKNOWN_SKILL")).toBe(true);
  });
});
