import { describe, expect, it } from "vitest";
import { canvasToDsl, lintCanvas } from "./canvas-to-dsl";
import {
  DEFAULT_RETRY_ON,
  defaultNodeData,
  defaultToolAccess,
  normalizeGuardrails,
  normalizeToolAccess,
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

describe("014 run contract defaults", () => {
  it("defaultNodeData includes retryOn, toolAccess inherit, retainContext false", () => {
    const data = defaultNodeData("SCRIPT", "worker");
    expect(data.guardrails.retryOn).toEqual(DEFAULT_RETRY_ON);
    expect(data.toolAccess).toEqual(defaultToolAccess());
    expect(data.retainContext).toBe(false);
  });

  it("normalizeGuardrails backfills retryOn on legacy shapes", () => {
    const g = normalizeGuardrails({
      timeoutMs: 1000,
      retryMax: 1,
      retryBackoffMs: 500,
    });
    expect(g.retryOn).toEqual(DEFAULT_RETRY_ON);
  });

  it("normalizeToolAccess defaults to inherit with empty allow", () => {
    expect(normalizeToolAccess(undefined)).toEqual({
      mode: "inherit",
      allow: [],
    });
  });
});

describe("014 canvasToDsl emit", () => {
  it("emits guardrails.retryOn, toolAccess, and retainContext", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("SC1", "SCRIPT", {
          label: "Worker",
          guardrails: {
            timeoutMs: 5000,
            retryMax: 2,
            retryBackoffMs: 250,
            retryOn: ["timeout", "tool_denied"],
          },
          toolAccess: { mode: "deny_all", allow: [] },
          retainContext: true,
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "SC1", "::STATE.SUCCESS"),
        edge("e2", "SC1", "END", "::SCRIPT.NEXT"),
        edge("e3", "SC1", "END", "::SCRIPT.ERROR"),
      ],
    };

    const dsl = canvasToDsl(canvas);
    const script = dsl.states.find((s: { id: string }) => s.id === "SC1") as {
      guardrails: {
        retryOn: string[];
        retryMax: number;
      };
      toolAccess: { mode: string; allow: string[] };
      retainContext: boolean;
      tool: { retry: { retryOn: string[] } };
    };

    expect(script.guardrails.retryOn).toEqual(["timeout", "tool_denied"]);
    expect(script.guardrails.retryMax).toBe(2);
    expect(script.toolAccess).toEqual({ mode: "deny_all", allow: [] });
    expect(script.retainContext).toBe(true);
    expect(script.tool.retry.retryOn).toEqual(["timeout", "tool_denied"]);
  });
});

describe("014 lintCanvas", () => {
  it("warns RETRY_IGNORED_ON_TYPE when retryMax > 0 on HUMAN", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("H1", "HUMAN", {
          guardrails: {
            timeoutMs: 30000,
            retryMax: 2,
            retryBackoffMs: 1000,
            retryOn: DEFAULT_RETRY_ON,
          },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "H1", "::STATE.SUCCESS"),
        edge("e2", "H1", "END", "::HUMAN.APPROVE"),
      ],
    };
    const issues = lintCanvas(canvas);
    expect(
      issues.some((i) => i.code === "RETRY_IGNORED_ON_TYPE" && i.nodeId === "H1")
    ).toBe(true);
  });

  it("warns RETAIN_CONTEXT_COST on AI with retainContext", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("A1", "AI", { retainContext: true }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "A1", "::STATE.SUCCESS"),
        edge("e2", "A1", "END", "::AI.NEXT"),
        edge("e3", "A1", "END", "::AI.ERROR"),
      ],
    };
    const issues = lintCanvas(canvas);
    expect(
      issues.some((i) => i.code === "RETAIN_CONTEXT_COST" && i.nodeId === "A1")
    ).toBe(true);
  });

  it("warns DENY_ALL_ON_SCRIPT when SCRIPT uses deny_all", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("SC1", "SCRIPT", {
          toolAccess: { mode: "deny_all", allow: [] },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "SC1", "::STATE.SUCCESS"),
        edge("e2", "SC1", "END", "::SCRIPT.NEXT"),
        edge("e3", "SC1", "END", "::SCRIPT.ERROR"),
      ],
    };
    const issues = lintCanvas(canvas);
    expect(
      issues.some(
        (i) => i.code === "DENY_ALL_ON_SCRIPT" && i.nodeId === "SC1"
      )
    ).toBe(true);
  });

  it("errors VERIFY_MISSING_CREDENTIAL for llm_verify without credential", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("SC1", "SCRIPT", {
          successCondition: {
            kind: "llm_verify",
            credentialId: "",
            modelId: "gpt-4o",
            rubric: "pass if ok",
            onFail: "error_signal",
          },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "SC1", "::STATE.SUCCESS"),
        edge("e2", "SC1", "END", "::SCRIPT.NEXT"),
        edge("e3", "SC1", "END", "::SCRIPT.ERROR"),
      ],
    };
    const issues = lintCanvas(canvas);
    expect(
      issues.some(
        (i) => i.code === "VERIFY_MISSING_CREDENTIAL" && i.nodeId === "SC1"
      )
    ).toBe(true);
  });
});
