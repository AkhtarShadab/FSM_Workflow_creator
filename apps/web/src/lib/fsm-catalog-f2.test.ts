import { describe, expect, it } from "vitest";
import {
  defaultNodeData,
  PALETTE_GROUPS,
  type CanvasData,
  type StateNode,
  type TransitionEdge,
} from "./fsm-types";
import {
  emptyRegistry,
  registerSignal,
  removeSignal,
  signalInUse,
} from "./registry";

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

describe("fsm catalog F2", () => {
  it("signalInUse is true when an edge uses the signal", () => {
    const canvas: CanvasData = {
      nodes: [node("S0", "START"), node("END", "END")],
      edges: [edge("e1", "S0", "END", "::MYAPP.DONE")],
    };
    expect(signalInUse(canvas, "::MYAPP.DONE")).toBe(true);
    expect(signalInUse(canvas, "::MYAPP.OTHER")).toBe(false);
  });

  it("signalInUse is true when HTTP successSignals reference the signal", () => {
    const http = defaultNodeData("HTTP", "Fetch").http;
    http.successSignals = ["::MYAPP.DONE"];
    const canvas: CanvasData = {
      nodes: [node("H1", "HTTP", { http })],
      edges: [],
    };
    expect(signalInUse(canvas, "::MYAPP.DONE")).toBe(true);
  });

  it("palette groups contain generative and custom", () => {
    const ids = PALETTE_GROUPS.map((g) => g.id);
    expect(ids).toContain("generative");
    expect(ids).toContain("custom");
  });

  it("registerSignal rejects short descriptions", () => {
    expect(() =>
      registerSignal(emptyRegistry(), "::MYAPP.DONE", "short")
    ).toThrow(/min 8 chars/);
  });

  it("removeSignal throws SIGNAL_IN_USE when canvas references signal", () => {
    const registry = registerSignal(
      emptyRegistry(),
      "::MYAPP.DONE",
      "project completion signal"
    );
    const canvas: CanvasData = {
      nodes: [node("S0", "START"), node("END", "END")],
      edges: [edge("e1", "S0", "END", "::MYAPP.DONE")],
    };
    expect(() => removeSignal(registry, "::MYAPP.DONE", canvas)).toThrow(
      /SIGNAL_IN_USE/
    );
  });
});
