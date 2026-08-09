import { describe, expect, it } from "vitest";
import {
  hasPathToEndUnderMask,
  lintCanvas,
} from "./canvas-to-dsl";
import {
  defaultNodeData,
  isStateDisabledByMask,
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

describe("isStateDisabledByMask", () => {
  it("disabled wins when listed in both lists", () => {
    expect(
      isStateDisabledByMask("X", {
        enabledStateIds: ["X"],
        disabledStateIds: ["X"],
      })
    ).toBe(true);
  });

  it("empty enabled list means no enable filter", () => {
    expect(
      isStateDisabledByMask("X", {
        enabledStateIds: [],
        disabledStateIds: [],
      })
    ).toBe(false);
  });

  it("non-empty enabled list disables absent ids", () => {
    expect(
      isStateDisabledByMask("Y", {
        enabledStateIds: ["X"],
        disabledStateIds: [],
      })
    ).toBe(true);
  });
});

describe("lintCanvas C2 SYS_FUNC mask", () => {
  it("errors when mask orphans END (MASK_NO_PATH_TO_END)", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("SC1", "SCRIPT", { label: "Work" }),
        node("SF1", "SYSTEM_FUNCTION", {
          label: "Gate",
          systemFunction: {
            summaryStrategy: "template",
            enabledStateIds: [],
            disabledStateIds: ["SC1", "END"],
            rewire: [],
          },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "SC1", "::SCRIPT.NEXT"),
        edge("e2", "SC1", "SF1", "::SCRIPT.NEXT"),
        edge("e3", "SF1", "END", "::SYSTEM.CHECKPOINT"),
        edge("e4", "SC1", "END", "::SCRIPT.ERROR"),
      ],
    };
    const issues = lintCanvas(canvas);
    expect(
      issues.some(
        (i) =>
          i.code === "MASK_NO_PATH_TO_END" &&
          i.severity === "error" &&
          i.nodeId === "SF1"
      )
    ).toBe(true);
  });

  it("errors on rewire to nonexistent node", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("SF1", "SYSTEM_FUNCTION", {
          label: "Gate",
          systemFunction: {
            summaryStrategy: "template",
            enabledStateIds: [],
            disabledStateIds: [],
            rewire: [{ from: "S0", on: "::SCRIPT.NEXT", to: "MISSING" }],
          },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "SF1", "::SCRIPT.NEXT"),
        edge("e2", "SF1", "END", "::SYSTEM.CHECKPOINT"),
      ],
    };
    const issues = lintCanvas(canvas);
    expect(
      issues.some(
        (i) =>
          i.code === "REWIRE_TARGET_MISSING" && i.severity === "error"
      )
    ).toBe(true);
  });

  it("valid rewire that restores path produces no MASK_NO_PATH_TO_END", () => {
    const mask = {
      summaryStrategy: "template" as const,
      enabledStateIds: [],
      disabledStateIds: ["SC1"],
      rewire: [{ from: "S0", on: "::SCRIPT.NEXT", to: "END" }],
    };
    const nodes = [
      node("S0", "START"),
      node("SC1", "SCRIPT", { label: "Work" }),
      node("SF1", "SYSTEM_FUNCTION", {
        label: "Gate",
        systemFunction: mask,
      }),
      node("END", "END"),
    ];
    const edges = [
      edge("e1", "S0", "SC1", "::SCRIPT.NEXT"),
      edge("e2", "SC1", "END", "::SCRIPT.NEXT"),
      edge("e3", "SC1", "END", "::SCRIPT.ERROR"),
      edge("e4", "S0", "SF1", "::SYSTEM.CHECKPOINT"),
    ];

    expect(hasPathToEndUnderMask(nodes, edges, mask)).toBe(true);

    const issues = lintCanvas({ nodes, edges });
    expect(issues.some((i) => i.code === "MASK_NO_PATH_TO_END")).toBe(false);
    expect(issues.some((i) => i.code === "REWIRE_TARGET_MISSING")).toBe(false);
  });

  it("warns when rewire has no matching authored edge", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("SF1", "SYSTEM_FUNCTION", {
          label: "Gate",
          systemFunction: {
            summaryStrategy: "template",
            enabledStateIds: ["S0", "END", "SF1"],
            disabledStateIds: [],
            rewire: [{ from: "S0", on: "::AI.NEXT", to: "END" }],
          },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "SF1", "::SCRIPT.NEXT"),
        edge("e2", "SF1", "END", "::SYSTEM.CHECKPOINT"),
      ],
    };
    const issues = lintCanvas(canvas);
    expect(
      issues.some(
        (i) =>
          i.code === "REWIRE_NO_MATCHING_EDGE" && i.severity === "warning"
      )
    ).toBe(true);
  });
});
