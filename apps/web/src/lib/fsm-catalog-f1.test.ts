import { describe, expect, it } from "vitest";
import { canvasToDsl, lintCanvas } from "./canvas-to-dsl";
import {
  DEFAULT_SIGNALS,
  STATE_SIGNAL_KITS,
  type CanvasData,
  type FSMStateType,
  type StateNode,
  type TransitionEdge,
} from "./fsm-types";
import {
  emptyRegistry,
  registerCustomState,
  registerSignal,
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
    data: {
      stateType: type,
      label: type,
      description: "",
      inputSchema: "",
      outputSchema: "",
      verify: { kind: "schema" },
      onError: { signal: "::SCRIPT.ERROR" },
      script: { toolName: "t", language: "python", code: "" },
      ai: {
        credentialId: "",
        model: "",
        temperature: 0.2,
        maxTokens: 4000,
        systemPrompt: "",
        outputSchema: "",
      },
      http: {
        method: "GET",
        urlTemplate: "",
        headers: {},
        successSignals: ["::HTTP.NEXT"],
      },
      validate: { kind: "schema" },
      externalAi: {
        credentialId: "",
        credentialKind: "openai_compatible",
        baseUrl: "",
        model: "",
        temperature: 0.2,
        maxTokens: 4000,
        systemPrompt: "",
        outputSchema: "",
      },
      human: { prompt: "", approvalSignals: ["::HUMAN.APPROVE"] },
      guardrails: { timeoutMs: 30000, retryMax: 2, retryBackoffMs: 1000 },
      spawn: {
        mode: "homogeneous",
        count: 1,
        maxConcurrency: 1,
        strategy: "waitAll",
        cancelOnParentHalt: true,
        profiles: [{ id: "p", childFsm: "c", toolPack: [], skillPack: [] }],
        aggregateTo: "",
      },
      aggregate: { fromSpawnId: "", strategy: "waitAll" },
      systemFunction: {
        summaryStrategy: "template",
        enabledStateIds: [],
        disabledStateIds: [],
        rewire: [],
        heads: [],
      },
      ...patch,
      stateType: type,
    },
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

describe("013 F1 — state signal kits", () => {
  const allTypes: FSMStateType[] = [
    "START",
    "SCRIPT",
    "HTTP",
    "AI",
    "EXTERNAL_AI",
    "VALIDATE",
    "HUMAN",
    "SPAWN",
    "AGGREGATE",
    "SYSTEM_FUNCTION",
    "END",
  ];

  it("STATE_SIGNAL_KITS covers every FSMStateType", () => {
    for (const type of allTypes) {
      expect(STATE_SIGNAL_KITS[type]).toBeDefined();
      expect(STATE_SIGNAL_KITS[type].success).toMatch(/^::/);
      expect(STATE_SIGNAL_KITS[type].failure).toMatch(/^::/);
    }
    expect(Object.keys(STATE_SIGNAL_KITS).sort()).toEqual(allTypes.sort());
  });

  it("START default signal is ::STATE.SUCCESS", () => {
    expect(DEFAULT_SIGNALS.START).toBe("::STATE.SUCCESS");
    expect(DEFAULT_SIGNALS.START).not.toBe("::SCRIPT.NEXT");
  });
});

describe("013 F1 — registry", () => {
  it("registerSignal rejects reserved namespaces", () => {
    expect(() =>
      registerSignal(emptyRegistry(), "::STATE.FOO", "nope")
    ).toThrow(/SIGNAL_RESERVED/);
    expect(() =>
      registerSignal(emptyRegistry(), "::AI.MYTHING", "nope")
    ).toThrow(/SIGNAL_RESERVED/);
  });

  it("registerSignal accepts custom namespace and is idempotent", () => {
    const once = registerSignal(
      emptyRegistry(),
      "::MYAPP.DONE",
      "ok done signal"
    );
    const twice = registerSignal(once, "::MYAPP.DONE", "ok done signal");
    expect(twice.customSignals).toHaveLength(1);
    expect(twice.customSignals[0]?.signal).toBe("::MYAPP.DONE");
  });

  it("registerCustomState rejects builtin id collision", () => {
    expect(() =>
      registerCustomState(emptyRegistry(), {
        id: "AI",
        label: "Dup",
        group: "custom",
        executorKind: "ai",
        defaultSignals: ["::AI.NEXT", "::AI.ERROR"],
        description: "collides with builtin",
      })
    ).toThrow(/CUSTOM_TYPE_COLLIDES_BUILTIN/);
  });
});

describe("013 F1 — canvas DSL + lint", () => {
  it("lintCanvas flags unknown signals", () => {
    const canvas: CanvasData = {
      nodes: [node("S0", "START"), node("END", "END")],
      edges: [edge("e1", "S0", "END", "::FOO.BAR")],
    };
    const issues = lintCanvas(canvas, { registry: emptyRegistry() });
    expect(issues.some((i) => i.code === "UNKNOWN_SIGNAL")).toBe(true);
  });

  it("lintCanvas accepts registered custom signals", () => {
    const registry = registerSignal(
      emptyRegistry(),
      "::MYAPP.DONE",
      "ok done signal"
    );
    const canvas: CanvasData = {
      nodes: [node("S0", "START"), node("END", "END")],
      edges: [edge("e1", "S0", "END", "::MYAPP.DONE")],
    };
    const issues = lintCanvas(canvas, { registry });
    expect(issues.some((i) => i.code === "UNKNOWN_SIGNAL")).toBe(false);
  });

  it("canvasToDsl emits successCondition, customTypeId, and extensions.registry", () => {
    const registry = registerSignal(
      emptyRegistry(),
      "::MYAPP.DONE",
      "ok done signal"
    );
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("SC1", "SCRIPT", {
          customTypeId: "review-gate",
          successCondition: { kind: "signal" },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "SC1", "::STATE.SUCCESS"),
        edge("e2", "SC1", "END", "::SCRIPT.NEXT"),
      ],
    };
    const dsl = canvasToDsl(canvas, { registry });
    const script = dsl.states.find((s: { id: string }) => s.id === "SC1") as {
      customTypeId?: string;
      successCondition?: { kind: string };
    };
    expect(script.customTypeId).toBe("review-gate");
    expect(script.successCondition).toEqual({ kind: "signal" });
    expect(dsl.extensions).toEqual({ registry });
  });
});
