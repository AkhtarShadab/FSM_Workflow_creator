import type { CopilotOp, FSMStateType } from "./copilot-ops";
import { CopilotOpError } from "./copilot-ops";

export interface CopilotNode {
  id: string;
  position: { x: number; y: number };
  data: { label: string; stateType: FSMStateType; [k: string]: unknown };
}

export interface CopilotEdge {
  id: string;
  source: string;
  target: string;
  data?: { signal?: string; kind?: string };
}

export interface CopilotCanvas {
  nodes: CopilotNode[];
  edges: CopilotEdge[];
}

export type ApplyResult =
  | { ok: true; canvas: CopilotCanvas; explains: string[] }
  | { ok: false; error: string; field?: string };

function clone(canvas: CopilotCanvas): CopilotCanvas {
  return structuredClone(canvas);
}

function resolveLabel(canvas: CopilotCanvas, label: string): CopilotNode | ApplyResult {
  const hits = canvas.nodes.filter((n) => n.data.label === label);
  if (hits.length === 0) {
    const suggestion = nearestLabel(canvas, label);
    return {
      ok: false,
      error: suggestion
        ? `Unknown label "${label}". Did you mean "${suggestion}"?`
        : `Unknown label "${label}".`,
      field: "label",
    };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      error: `Ambiguous label "${label}" matches ${hits.length} nodes.`,
      field: "label",
    };
  }
  return hits[0];
}

function nearestLabel(canvas: CopilotCanvas, label: string): string | undefined {
  const lower = label.toLowerCase();
  return canvas.nodes
    .map((n) => n.data.label)
    .find((l) => l.toLowerCase().includes(lower) || lower.includes(l.toLowerCase()));
}

export function layoutPosition(
  canvas: CopilotCanvas,
  predecessorId?: string
): { x: number; y: number } {
  const pred = predecessorId
    ? canvas.nodes.find((n) => n.id === predecessorId)
    : canvas.nodes[canvas.nodes.length - 1];
  const base = pred?.position ?? { x: 80, y: 80 };
  const pos = { x: base.x + 220, y: base.y };
  const occupied = new Set(canvas.nodes.map((n) => `${n.position.x},${n.position.y}`));
  let guard = 0;
  while (occupied.has(`${pos.x},${pos.y}`) && guard < 20) {
    pos.y += 80;
    guard += 1;
  }
  return pos;
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}`;
}

/** Apply a batch atomically. Invalid op → original canvas unchanged. */
export function applyCopilotBatch(
  canvas: CopilotCanvas,
  ops: CopilotOp[]
): ApplyResult {
  const next = clone(canvas);
  const explains: string[] = [];
  for (const op of ops) {
    if (op.op === "explain") {
      explains.push(op.text);
      continue;
    }
    if (op.op === "add_node") {
      const pos = op.position ?? layoutPosition(next);
      next.nodes.push({
        id: nextId("n"),
        position: pos,
        data: { label: op.label, stateType: op.stateType },
      });
      continue;
    }
    if (op.op === "connect") {
      const src = resolveLabel(next, op.sourceLabel);
      if ("ok" in src) return src;
      const tgt = resolveLabel(next, op.targetLabel);
      if ("ok" in tgt) return tgt;
      next.edges.push({
        id: nextId("e"),
        source: src.id,
        target: tgt.id,
        data: {
          signal: op.signal ?? "::SCRIPT.NEXT",
          kind: op.kind ?? "flow",
        },
      });
      continue;
    }
    if (op.op === "set_config") {
      const node = resolveLabel(next, op.nodeLabel);
      if ("ok" in node) return node;
      Object.assign(node.data, op.patch);
      continue;
    }
    if (op.op === "delete_node") {
      const node = resolveLabel(next, op.nodeLabel);
      if ("ok" in node) return node;
      next.nodes = next.nodes.filter((n) => n.id !== node.id);
      next.edges = next.edges.filter((e) => e.source !== node.id && e.target !== node.id);
      continue;
    }
    if (op.op === "rename_node") {
      const node = resolveLabel(next, op.nodeLabel);
      if ("ok" in node) return node;
      node.data.label = op.newLabel;
    }
  }
  return { ok: true, canvas: next, explains };
}

export function parseProseOrOps(raw: unknown): CopilotOp[] {
  if (typeof raw === "string") {
    return [{ op: "explain", text: raw.slice(0, 2000) }];
  }
  if (Array.isArray(raw)) return raw as CopilotOp[];
  if (raw && typeof raw === "object" && "op" in raw) return [raw as CopilotOp];
  throw new CopilotOpError("ops", "Expected an op, an array of ops, or prose");
}
