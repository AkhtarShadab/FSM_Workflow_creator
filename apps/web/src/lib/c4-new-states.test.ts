import { describe, expect, it } from "vitest";
import { canvasToDsl, lintCanvas } from "./canvas-to-dsl";
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

describe("C4 new states DSL + lint", () => {
  it("emits HTTP / VALIDATE / EXTERNAL_AI shapes", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("H1", "HTTP", {
          http: {
            method: "POST",
            urlTemplate: "https://api.example.com/x",
            headers: { "X-Test": "1" },
            successSignals: ["::HTTP.NEXT"],
            bodyTemplate: "{}",
          },
        }),
        node("V1", "VALIDATE", {
          validate: { kind: "schema", schema: '{"type":"object"}' },
        }),
        node("E1", "EXTERNAL_AI", {
          externalAi: {
            ...defaultNodeData("EXTERNAL_AI", "Ext").externalAi,
            model: "gpt-4o-mini",
            credentialKind: "openai_compatible",
          },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "H1", "::SCRIPT.NEXT"),
        edge("e2", "H1", "V1", "::HTTP.NEXT"),
        edge("e3", "V1", "E1", "::VALIDATE.NEXT"),
        edge("e4", "E1", "END", "::EXTERNAL_AI.NEXT"),
      ],
    };

    const dsl = canvasToDsl(canvas);
    const http = dsl.states.find((s: { id: string }) => s.id === "H1") as {
      http: { method: string; successSignals: string[] };
    };
    const validate = dsl.states.find((s: { id: string }) => s.id === "V1") as {
      validate: { kind: string };
    };
    const external = dsl.states.find((s: { id: string }) => s.id === "E1") as {
      externalAi: { model: string; credentialKind: string };
    };

    expect(http.http.method).toBe("POST");
    expect(http.http.successSignals).toEqual(["::HTTP.NEXT"]);
    expect(validate.validate.kind).toBe("schema");
    expect(external.externalAi.model).toBe("gpt-4o-mini");
    expect(external.externalAi.credentialKind).toBe("openai_compatible");
  });

  it("errors when HTTP has no successSignals", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("H1", "HTTP", {
          label: "Call",
          http: {
            method: "GET",
            urlTemplate: "https://example.com",
            headers: {},
            successSignals: [],
          },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "H1", "::SCRIPT.NEXT"),
        edge("e2", "H1", "END", "::HTTP.NEXT"),
        edge("e3", "H1", "END", "::HTTP.ERROR"),
      ],
    };
    const issues = lintCanvas(canvas);
    expect(
      issues.some(
        (i) =>
          i.code === "HTTP_NO_SUCCESS_SIGNALS" && i.severity === "error"
      )
    ).toBe(true);
  });

  it("warns on undeclared payload keys in HTTP url", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("H1", "HTTP", {
          label: "Call",
          http: {
            method: "GET",
            urlTemplate: "https://example.com/{{payload.userId}}",
            headers: {},
            successSignals: ["::HTTP.NEXT"],
          },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "H1", "::SCRIPT.NEXT"),
        edge("e2", "H1", "END", "::HTTP.NEXT"),
        edge("e3", "H1", "END", "::HTTP.ERROR"),
      ],
    };
    const issues = lintCanvas(canvas);
    expect(
      issues.some(
        (i) =>
          i.code === "HTTP_UNDECLARED_PAYLOAD_KEY" &&
          i.severity === "warning"
      )
    ).toBe(true);
  });

  it("errors when VALIDATE schema is empty", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("V1", "VALIDATE", {
          label: "Check",
          validate: { kind: "schema", schema: "" },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "V1", "::SCRIPT.NEXT"),
        edge("e2", "V1", "END", "::VALIDATE.NEXT"),
        edge("e3", "V1", "END", "::VALIDATE.ERROR"),
      ],
    };
    const issues = lintCanvas(canvas);
    expect(
      issues.some(
        (i) => i.code === "VALIDATE_INCOMPLETE" && i.severity === "error"
      )
    ).toBe(true);
  });

  it("defaultNodeData includes http/validate/externalAi", () => {
    const http = defaultNodeData("HTTP", "HTTP");
    const validate = defaultNodeData("VALIDATE", "Validate");
    const ext = defaultNodeData("EXTERNAL_AI", "Ext");
    expect(http.http.method).toBe("GET");
    expect(validate.validate.kind).toBe("schema");
    expect(ext.externalAi.credentialKind).toBe("openai_compatible");
  });
});
