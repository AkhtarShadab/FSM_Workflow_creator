import { describe, expect, it } from "vitest";
import {
  applyCopilotBatch,
  layoutPosition,
  parseCopilotOps,
  parseProseOrOps,
  type CopilotCanvas,
} from "./index";

const empty = (): CopilotCanvas => ({ nodes: [], edges: [] });

describe("parseCopilotOps", () => {
  it("parses every op variant", () => {
    const ops = parseCopilotOps([
      { op: "add_node", stateType: "HTTP", label: "Fetch" },
      { op: "connect", sourceLabel: "Fetch", targetLabel: "END", signal: "::HTTP.NEXT" },
      { op: "set_config", nodeLabel: "Fetch", patch: { url: "https://example.com" } },
      { op: "rename_node", nodeLabel: "Fetch", newLabel: "Get" },
      { op: "delete_node", nodeLabel: "Get" },
      { op: "explain", text: "done" },
    ]);
    expect(ops).toHaveLength(6);
  });

  it("rejects unknown op and overlong labels", () => {
    expect(() => parseCopilotOps([{ op: "explode" }])).toThrow();
    expect(() =>
      parseCopilotOps([{ op: "add_node", stateType: "HTTP", label: "x".repeat(61) }])
    ).toThrow();
    expect(() =>
      parseCopilotOps([{ op: "add_node", stateType: "NOPE", label: "A" }])
    ).toThrow();
  });
});

describe("applyCopilotBatch", () => {
  it("applies add + connect atomically", () => {
    const r = applyCopilotBatch(empty(), [
      { op: "add_node", stateType: "START", label: "S0" },
      { op: "add_node", stateType: "END", label: "END" },
      { op: "connect", sourceLabel: "S0", targetLabel: "END" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.canvas.nodes).toHaveLength(2);
    expect(r.canvas.edges).toHaveLength(1);
  });

  it("does not mutate on a later invalid op", () => {
    const start: CopilotCanvas = {
      nodes: [
        { id: "a", position: { x: 0, y: 0 }, data: { label: "S0", stateType: "START" } },
      ],
      edges: [],
    };
    const r = applyCopilotBatch(start, [
      { op: "add_node", stateType: "HTTP", label: "H" },
      { op: "connect", sourceLabel: "missing", targetLabel: "S0" },
    ]);
    expect(r.ok).toBe(false);
    expect(start.nodes).toHaveLength(1);
  });

  it("rejects unknown labels with a suggestion", () => {
    const canvas: CopilotCanvas = {
      nodes: [
        { id: "a", position: { x: 0, y: 0 }, data: { label: "FetchPages", stateType: "HTTP" } },
      ],
      edges: [],
    };
    const r = applyCopilotBatch(canvas, [{ op: "delete_node", nodeLabel: "Fetch" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/FetchPages/);
  });

  it("rejects ambiguous labels", () => {
    const canvas: CopilotCanvas = {
      nodes: [
        { id: "a", position: { x: 0, y: 0 }, data: { label: "X", stateType: "START" } },
        { id: "b", position: { x: 1, y: 0 }, data: { label: "X", stateType: "END" } },
      ],
      edges: [],
    };
    const r = applyCopilotBatch(canvas, [{ op: "delete_node", nodeLabel: "X" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Ambiguous/);
  });

  it("layout is deterministic and avoids overlap", () => {
    const a = empty();
    a.nodes.push({ id: "s", position: { x: 0, y: 0 }, data: { label: "S", stateType: "START" } });
    const p1 = layoutPosition(a, "s");
    const p2 = layoutPosition(a, "s");
    expect(p1).toEqual(p2);
    a.nodes.push({ id: "n", position: p1, data: { label: "N", stateType: "HTTP" } });
    const p3 = layoutPosition(a, "s");
    expect(p3).not.toEqual(p1);
  });

  it("treats prose as explain with no mutation", () => {
    const ops = parseProseOrOps("hello canvas");
    expect(ops).toEqual([{ op: "explain", text: "hello canvas" }]);
    const r = applyCopilotBatch(empty(), ops);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.canvas.nodes).toHaveLength(0);
    expect(r.explains[0]).toBe("hello canvas");
  });
});
