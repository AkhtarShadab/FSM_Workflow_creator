import type { CanvasData, StateNode } from "./fsm-types";

/**
 * canvasToDsl — pure function (§10.2: "FSM DSL is derived via a pure
 * canvasToDsl() function (unit-testable, no DOM)").
 *
 * Converts React Flow canvas state into the versioned FSM Definition DSL
 * described in §5.2 of the design plan.
 */
export function canvasToDsl(
  canvas: CanvasData,
  meta: { name?: string; version?: number } = {}
) {
  const { nodes, edges } = canvas;

  const states = nodes.map((node) => {
    const transitions = edges
      .filter((e) => e.source === node.id)
      .map((e) => ({
        on: e.data?.signal ?? "::SCRIPT.NEXT",
        to: e.target,
      }));

    const base = {
      id: node.id,
      type: node.data.stateType,
      label: node.data.label,
      ...(node.data.description ? { description: node.data.description } : {}),
      transitions,
    };

    switch (node.data.stateType) {
      case "SCRIPT":
        return {
          ...base,
          tool: {
            name: node.data.script.toolName,
            language: node.data.script.language,
            timeoutMs: node.data.guardrails.timeoutMs,
            retry: {
              max: node.data.guardrails.retryMax,
              backoffMs: node.data.guardrails.retryBackoffMs,
            },
          },
        };
      case "AI":
        return {
          ...base,
          llm: {
            model: node.data.ai.model,
            temperature: node.data.ai.temperature,
            maxTokens: node.data.ai.maxTokens,
            systemPrompt: node.data.ai.systemPrompt,
            ...(node.data.ai.outputSchema
              ? { outputSchema: safeJson(node.data.ai.outputSchema) }
              : {}),
          },
        };
      case "SPAWN":
        return {
          ...base,
          spawn: {
            childFsm: node.data.spawn.childFsm,
            count: node.data.spawn.count,
            strategy: node.data.spawn.strategy,
            timeoutMs: node.data.guardrails.timeoutMs,
          },
        };
      case "SYSTEM_FUNCTION":
        return {
          ...base,
          checkpoint: { summaryStrategy: node.data.systemFunction.summaryStrategy },
        };
      case "START":
        return {
          ...base,
          hydration: { emitPhaseMap: true },
        };
      default:
        return base;
    }
  });

  return {
    version: meta.version ?? 1,
    name: meta.name ?? "untitled-harness",
    config: {
      toolLanguage: "python",
      checkpointStore: "redis",
      tokenBudget: { perRun: 200000, perState: 20000, onExceed: "halt" },
    },
    clusters: [],
    states,
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Lint helpers (E4 — FSM linter, lightweight v0) */
export function lintCanvas(canvas: CanvasData): string[] {
  const warnings: string[] = [];
  const { nodes, edges } = canvas;

  const starts = nodes.filter((n) => n.data.stateType === "START");
  if (starts.length === 0) warnings.push("Missing START state.");
  if (starts.length > 1) warnings.push("Multiple START states defined.");

  const ends = nodes.filter((n) => n.data.stateType === "END");
  if (ends.length === 0) warnings.push("Missing END state.");

  const targetIds = new Set(edges.map((e) => e.target));
  for (const n of nodes) {
    if (n.data.stateType !== "START" && !targetIds.has(n.id)) {
      warnings.push(`State "${n.data.label}" (${n.id}) is unreachable.`);
    }
  }

  const sourceIds = new Set(edges.map((e) => e.source));
  for (const n of nodes) {
    if (n.data.stateType !== "END" && !sourceIds.has(n.id)) {
      warnings.push(`State "${n.data.label}" (${n.id}) is a dead end.`);
    }
  }

  return warnings;
}
