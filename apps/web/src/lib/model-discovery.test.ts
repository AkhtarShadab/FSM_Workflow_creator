import { describe, expect, it, vi } from "vitest";
import {
  discoverModels,
  isDiscoveryStale,
  unionDiscoveredModels,
} from "./model-discovery";
import { lintCanvas } from "./canvas-to-dsl";
import { defaultNodeData, type CanvasData, type StateNode, type TransitionEdge } from "./fsm-types";

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

describe("model discovery", () => {
  it("parses openai-compatible /v1/models", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini", name: "Mini" }],
      })
    );
    const result = await discoverModels({
      provider: "openai",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.models.map((m) => m.modelId)).toEqual([
        "gpt-4o",
        "gpt-4o-mini",
      ]);
    }
  });

  it("keeps other keys usable when one discovery fails", async () => {
    const ok = await discoverModels({
      provider: "openai",
      baseUrl: "https://ok.example",
      apiKey: "a",
      fetchFn: (async () =>
        Response.json({ data: [{ id: "m1" }] })) as unknown as typeof fetch,
    });
    const bad = await discoverModels({
      provider: "openai",
      baseUrl: "https://bad.example",
      apiKey: "b",
      fetchFn: (async () =>
        new Response("nope", { status: 500 })) as unknown as typeof fetch,
    });
    expect(ok.ok).toBe(true);
    expect(bad.ok).toBe(false);
    const union = unionDiscoveredModels([
      {
        credentialId: "a",
        label: "A",
        models: ok.ok ? ok.models.map((m) => m.modelId) : [],
        active: true,
      },
      {
        credentialId: "b",
        label: "B",
        models: [],
        active: true,
      },
    ]);
    expect(union.some((u) => u.modelId === "m1")).toBe(true);
  });

  it("TTL marks stale discovery", () => {
    expect(isDiscoveryStale(Date.now() - 1000, 5000)).toBe(false);
    expect(isDiscoveryStale(Date.now() - 10_000, 5000)).toBe(true);
    expect(isDiscoveryStale(null)).toBe(true);
  });

  it("lints broken and inactive credential refs", () => {
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("AI1", "AI", {
          label: "Think",
          ai: {
            ...defaultNodeData("AI", "AI").ai,
            credentialId: "gone",
            model: "gpt-4o",
          },
        }),
        node("AI2", "AI", {
          label: "Think2",
          ai: {
            ...defaultNodeData("AI", "AI").ai,
            credentialId: "c1",
            model: "mystery",
          },
        }),
        node("END", "END"),
      ],
      edges: [
        edge("e1", "S0", "AI1", "::SCRIPT.NEXT"),
        edge("e2", "AI1", "AI2", "::AI.NEXT"),
        edge("e3", "AI2", "END", "::AI.NEXT"),
        edge("e4", "AI1", "END", "::AI.VALIDATION_ERROR"),
        edge("e5", "AI2", "END", "::AI.VALIDATION_ERROR"),
      ],
    };
    const issues = lintCanvas(canvas, {
      credentials: [
        { id: "c1", active: false, models: ["gpt-4o"] },
      ],
    });
    expect(issues.some((i) => i.code === "AI_CREDENTIAL_MISSING")).toBe(true);
    expect(issues.some((i) => i.code === "AI_CREDENTIAL_INACTIVE")).toBe(true);
  });
});
