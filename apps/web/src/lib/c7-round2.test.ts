import { describe, expect, it } from "vitest";
import { canvasToDsl, hasPathToEndUnderMask, lintCanvas } from "./canvas-to-dsl";
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
  signal: string,
  extra: Partial<TransitionEdge["data"]> = {}
): TransitionEdge {
  return {
    id,
    source,
    target,
    type: "script",
    data: { signal, ...extra },
    label: signal,
  };
}

describe("FeatureShipping 001 C7 Round 2", () => {
  it("emits SYS_FUNC heads, HUMAN, AGGREGATE, and edge kinds in DSL", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("H1", "HUMAN", { label: "Approve" }),
        node("SF1", "SYSTEM_FUNCTION", {
          label: "Router",
          systemFunction: {
            summaryStrategy: "template",
            enabledStateIds: [],
            disabledStateIds: [],
            rewire: [],
            heads: [
              {
                id: "h1",
                label: "In",
                direction: "in",
                componentRef: "S0",
              },
              {
                id: "h2",
                label: "Out",
                direction: "out",
                componentRef: "H1",
              },
            ],
          },
        }),
        node("SP1", "SPAWN", {
          spawn: {
            ...defaultNodeData("SPAWN", "Spawn").spawn,
            aggregateTo: "AG1",
            count: 3,
          },
        }),
        node("AG1", "AGGREGATE", {
          aggregate: { fromSpawnId: "SP1", strategy: "waitAll" },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "SF1", "::SCRIPT.NEXT"),
        edge("e2", "SF1", "H1", "::SYSTEM.HYDRATE", { kind: "router" }),
        edge("e3", "H1", "H1", "::HUMAN.EDIT", {
          kind: "self-loop",
          maxIterations: 3,
        }),
        edge("e4", "H1", "SP1", "::HUMAN.APPROVE"),
        edge("e5", "SP1", "AG1", "::SPAWN.SUBAGENTS"),
        edge("e6", "AG1", "END", "::SCRIPT.NEXT"),
      ],
    };

    const dsl = canvasToDsl(canvas, { name: "c7" });
    const sf = dsl.states.find((s: { id: string }) => s.id === "SF1") as {
      checkpoint: { heads: unknown[] };
    };
    expect(sf.checkpoint.heads).toHaveLength(2);

    const human = dsl.states.find((s: { id: string }) => s.id === "H1") as {
      human: { approvalSignals: string[] };
    };
    expect(human.human.approvalSignals).toContain("::HUMAN.APPROVE");

    const agg = dsl.states.find((s: { id: string }) => s.id === "AG1") as {
      aggregate: { fromSpawnId: string };
    };
    expect(agg.aggregate.fromSpawnId).toBe("SP1");

    const loop = (
      dsl.states.find((s: { id: string }) => s.id === "H1") as {
        transitions: Array<{ kind?: string; maxIterations?: number }>;
      }
    ).transitions.find((t) => t.kind === "self-loop");
    expect(loop?.maxIterations).toBe(3);
  });

  it("lints VALIDATE executor body and missing self-loop maxIterations", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("V1", "VALIDATE", {
          label: "Gate",
          script: {
            ...defaultNodeData("VALIDATE", "Gate").script,
            code: "print('oops')",
          },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "V1", "::SCRIPT.NEXT"),
        edge("e2", "V1", "V1", "::VALIDATE.NEXT", {
          kind: "self-loop",
          maxIterations: undefined,
        }),
        edge("e3", "V1", "END", "::VALIDATE.ERROR"),
      ],
    };

    // Force missing maxIterations after normalize would fill it — set kind only via raw data
    canvas.edges[1].data = { signal: "::VALIDATE.NEXT", kind: "self-loop" };

    const issues = lintCanvas(canvas);
    expect(issues.some((i) => i.code === "VALIDATE_HAS_EXECUTOR")).toBe(true);
    // normalizeEdgeData fills default maxIterations=3 when reading — SELF_LOOP_MISSING only if null after normalize
    // Our lint uses normalizeEdgeData which defaults to 3, so missing maxIterations won't fire.
    // Explicitly wipe after: set maxIterations to 0
    canvas.edges[1].data = {
      signal: "::VALIDATE.NEXT",
      kind: "self-loop",
      maxIterations: 0,
    };
    const issues2 = lintCanvas(canvas);
    expect(issues2.some((i) => i.code === "SELF_LOOP_MISSING_MAX_ITER")).toBe(
      true
    );
  });

  it("lints SYS_FUNC few heads and AGGREGATE pairing mismatch", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("SF1", "SYSTEM_FUNCTION", {
          label: "Router",
          systemFunction: {
            summaryStrategy: "template",
            enabledStateIds: [],
            disabledStateIds: [],
            rewire: [],
            heads: [
              {
                id: "only",
                label: "One",
                direction: "out",
                componentRef: "MISSING_NODE",
              },
            ],
          },
        }),
        node("SP1", "SPAWN", {
          spawn: {
            ...defaultNodeData("SPAWN", "Spawn").spawn,
            aggregateTo: "AG1",
          },
        }),
        node("SP2", "SPAWN", {
          spawn: {
            ...defaultNodeData("SPAWN", "Spawn2").spawn,
            aggregateTo: "AG1",
          },
        }),
        node("AG1", "AGGREGATE", {
          aggregate: { fromSpawnId: "SP1", strategy: "waitAll" },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "SF1", "::SCRIPT.NEXT"),
        edge("e2", "SF1", "END", "::SYSTEM.HYDRATE"),
      ],
    };

    const issues = lintCanvas(canvas);
    expect(issues.some((i) => i.code === "SYSFUNC_FEW_HEADS")).toBe(true);
    expect(issues.some((i) => i.code === "SYSFUNC_HEAD_UNRESOLVED")).toBe(true);
    expect(issues.some((i) => i.code === "AGGREGATE_MULTIPLE_SPAWN")).toBe(
      true
    );
  });

  it("mask reachability ignores router edges like other flow lints", () => {
    const emptyMask = {
      summaryStrategy: "template" as const,
      enabledStateIds: [],
      disabledStateIds: [],
      rewire: [],
      heads: [],
    };
    const nodes = [node("S0", "START"), node("SF1", "SYSTEM_FUNCTION"), node("END", "END")];

    // START → END only via a router edge: no real flow path exists.
    const routerOnly = [
      edge("e1", "S0", "SF1", "::SCRIPT.NEXT"),
      edge("e2", "SF1", "END", "::SYSTEM.HYDRATE", { kind: "router" }),
    ];
    expect(hasPathToEndUnderMask(nodes, routerOnly, emptyMask)).toBe(false);

    // Same wiring with a flow edge reaches END.
    const flow = [
      edge("e1", "S0", "SF1", "::SCRIPT.NEXT"),
      edge("e2", "SF1", "END", "::SYSTEM.HYDRATE"),
    ];
    expect(hasPathToEndUnderMask(nodes, flow, emptyMask)).toBe(true);
  });
});
