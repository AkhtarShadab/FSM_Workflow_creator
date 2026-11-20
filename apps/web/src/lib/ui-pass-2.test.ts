/** Tests for the second review pass (responsiveness + missing features). */
import { describe, expect, it } from "vitest";
import { applyNodeChanges } from "@xyflow/react";
import { defaultNodeData, type StateNode } from "./fsm-types";
import {
  emptyRegistry,
  registerSysFuncTemplate,
  removeSysFuncTemplate,
} from "./registry";
import { sameLogicalNodes } from "@/stores/canvas-store";

const node = (id: string): StateNode => ({
  id,
  type: "stateCircle",
  position: { x: 0, y: 0 },
  data: defaultNodeData("SCRIPT", id),
});

describe("sameLogicalNodes (drag churn filter)", () => {
  it("ignores position and selection changes", () => {
    const nodes = [node("A"), node("B")];
    const moved = applyNodeChanges<StateNode>(
      [
        { type: "position", id: "A", position: { x: 50, y: 80 }, dragging: true },
        { type: "select", id: "B", selected: true },
      ],
      nodes
    );
    expect(moved).not.toBe(nodes);
    expect(sameLogicalNodes(nodes, moved)).toBe(true);
  });

  it("detects data edits, additions and removals", () => {
    const nodes = [node("A"), node("B")];
    const edited = nodes.map((n) =>
      n.id === "A" ? { ...n, data: { ...n.data, label: "X" } } : n
    );
    expect(sameLogicalNodes(nodes, edited)).toBe(false);
    expect(sameLogicalNodes(nodes, [...nodes, node("C")])).toBe(false);
    expect(sameLogicalNodes(nodes, [nodes[0]])).toBe(false);
  });
});

describe("SYS_FUNC templates (§3.6)", () => {
  const tpl = {
    id: "tpl-a",
    label: "A",
    summaryStrategy: "template" as const,
    enabledStateIds: ["S1"],
    disabledStateIds: [],
    rewire: [],
  };

  it("saves, overwrites by id, and removes", () => {
    let r = registerSysFuncTemplate(emptyRegistry(), tpl);
    expect(r.sysFuncTemplates).toHaveLength(1);
    r = registerSysFuncTemplate(r, { ...tpl, enabledStateIds: ["S2"] });
    expect(r.sysFuncTemplates).toHaveLength(1);
    expect(r.sysFuncTemplates[0].enabledStateIds).toEqual(["S2"]);
    r = removeSysFuncTemplate(r, "tpl-a");
    expect(r.sysFuncTemplates).toHaveLength(0);
  });

  it("rejects empty ids/labels", () => {
    expect(() => registerSysFuncTemplate(emptyRegistry(), { ...tpl, id: " " })).toThrow();
    expect(() => registerSysFuncTemplate(emptyRegistry(), { ...tpl, label: "" })).toThrow();
  });
});
