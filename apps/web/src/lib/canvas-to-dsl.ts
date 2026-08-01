import {
  normalizeSpawn,
  primaryProfile,
  type CanvasData,
} from "./fsm-types";

/**
 * canvasToDsl — pure function (§10.2: "FSM DSL is derived via a pure
 * canvasToDsl() function (unit-testable, no DOM)").
 *
 * Converts React Flow canvas state into the versioned FSM Definition DSL
 * described in §5.2 of the design plan + FeatureShipping 001 C1 fields.
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

    const verifiability = {
      ...(node.data.inputSchema ? { inputSchema: safeJson(node.data.inputSchema) } : {}),
      ...(node.data.outputSchema
        ? { outputSchema: safeJson(node.data.outputSchema) }
        : {}),
      verify: node.data.verify ?? { kind: "schema" },
      onError: node.data.onError ?? { signal: "::SCRIPT.ERROR" },
    };

    const base = {
      id: node.id,
      type: node.data.stateType,
      label: node.data.label,
      ...(node.data.description ? { description: node.data.description } : {}),
      ...verifiability,
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
            ...(node.data.ai.credentialId
              ? { credentialId: node.data.ai.credentialId }
              : {}),
            model: node.data.ai.model,
            temperature: node.data.ai.temperature,
            maxTokens: node.data.ai.maxTokens,
            systemPrompt: node.data.ai.systemPrompt,
            ...(node.data.ai.outputSchema
              ? { outputSchema: safeJson(node.data.ai.outputSchema) }
              : {}),
          },
        };
      case "SPAWN": {
        const spawn = normalizeSpawn(node.data.spawn);
        return {
          ...base,
          spawn: {
            mode: spawn.mode,
            count: spawn.count,
            maxConcurrency: Math.max(1, spawn.maxConcurrency),
            strategy: spawn.strategy,
            ...(spawn.strategy === "quorum" && spawn.quorumK != null
              ? { quorumK: spawn.quorumK }
              : {}),
            cancelOnParentHalt: spawn.cancelOnParentHalt,
            profiles: spawn.profiles,
            aggregateTo: spawn.aggregateTo,
            timeoutMs: node.data.guardrails.timeoutMs,
          },
        };
      }
      case "SYSTEM_FUNCTION":
        return {
          ...base,
          checkpoint: {
            summaryStrategy: node.data.systemFunction.summaryStrategy,
            enabledStateIds: node.data.systemFunction.enabledStateIds ?? [],
            disabledStateIds: node.data.systemFunction.disabledStateIds ?? [],
            rewire: node.data.systemFunction.rewire ?? [],
          },
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

const ERROR_SIGNAL_HINT = /\.ERROR|VALIDATION_ERROR|HALT/;

/** Lint helpers (E4 — FSM linter + FeatureShipping 001 C1) */
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

  const runnable = nodes.filter((n) =>
    ["SCRIPT", "AI", "SPAWN"].includes(n.data.stateType)
  );
  for (const n of runnable) {
    const outs = edges.filter((e) => e.source === n.id);
    const hasErrorEdge = outs.some((e) =>
      ERROR_SIGNAL_HINT.test(e.data?.signal ?? "")
    );
    if (!hasErrorEdge) {
      warnings.push(
        `State "${n.data.label}" (${n.id}) has no error-routing edge (::*.ERROR / VALIDATION_ERROR).`
      );
    }
  }

  for (const n of nodes.filter((x) => x.data.stateType === "SPAWN")) {
    const spawn = normalizeSpawn(n.data.spawn);
    const profile = primaryProfile(spawn);

    if (spawn.maxConcurrency < 1) {
      warnings.push(`SPAWN "${n.data.label}": maxConcurrency must be ≥ 1.`);
    }

    if (spawn.mode === "heterogeneous" && spawn.profiles.length !== spawn.count) {
      warnings.push(
        `SPAWN "${n.data.label}": heterogeneous mode requires profiles.length === count (${spawn.profiles.length} ≠ ${spawn.count}).`
      );
    }

    if (profile.toolPack.length === 0) {
      warnings.push(
        `SPAWN "${n.data.label}": empty tool pack — AI-only children OK; SCRIPT children will have no tools.`
      );
    }

    for (const skill of profile.skillPack) {
      if (!skill.trim()) {
        warnings.push(`SPAWN "${n.data.label}": empty skill ref in skill pack.`);
      }
    }

    // Project skill registry lands later — flag unknown-looking empty ids only for now.
    // Non-empty string refs are accepted as opaque ids (C1).
  }

  return warnings;
}
