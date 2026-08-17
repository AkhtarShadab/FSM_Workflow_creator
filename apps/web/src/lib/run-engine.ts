import type { EngineEdge, EngineState } from "@fsm/engine";
import type { CanvasData } from "@/lib/fsm-types";
import { normalizeSpawn } from "@/lib/fsm-types";

export function canvasToEngine(canvas: CanvasData): {
  states: EngineState[];
  edges: EngineEdge[];
} {
  const states: EngineState[] = canvas.nodes.map((n) => {
    const base: EngineState = {
      id: n.id,
      type: n.data.stateType,
      label: n.data.label,
      onErrorSignal: n.data.onError?.signal ?? "::SCRIPT.ERROR",
      guardrails: {
        timeoutMs: n.data.guardrails.timeoutMs,
        retryMax: n.data.guardrails.retryMax,
        retryBackoffMs: n.data.guardrails.retryBackoffMs,
        retryOn: n.data.guardrails.retryOn,
      },
    };
    if (n.data.inputSchema) {
      try {
        base.inputSchema = JSON.parse(n.data.inputSchema);
      } catch {
        /* ignore */
      }
    }
    if (n.data.stateType === "SYSTEM_FUNCTION") {
      base.mask = {
        enabledStateIds: n.data.systemFunction.enabledStateIds ?? [],
        disabledStateIds: n.data.systemFunction.disabledStateIds ?? [],
        rewire: n.data.systemFunction.rewire ?? [],
      };
    }
    if (n.data.stateType === "SPAWN") {
      const spawn = normalizeSpawn(n.data.spawn);
      base.spawn = {
        mode: spawn.mode,
        count: spawn.count,
        maxConcurrency: spawn.maxConcurrency,
        strategy: spawn.strategy,
        quorumK: spawn.quorumK,
        cancelOnParentHalt: spawn.cancelOnParentHalt,
        profiles: spawn.profiles.map((p) => ({
          id: p.id,
          toolPack: p.toolPack,
          skillPack: p.skillPack,
          timeoutMs: p.timeoutMs,
        })),
      };
    }
    if (n.data.stateType === "VALIDATE") {
      try {
        base.inputSchema = n.data.validate.schema
          ? JSON.parse(n.data.validate.schema)
          : { type: "object" };
      } catch {
        base.inputSchema = { type: "object" };
      }
    }
    if (n.data.stateType === "HUMAN") {
      const humanMs = n.data.human?.timeoutMs ?? 3_600_000;
      const g = n.data.guardrails;
      base.guardrails = {
        timeoutMs: Math.max(g?.timeoutMs ?? 0, humanMs + 5_000),
        retryMax: 0,
        retryBackoffMs: g?.retryBackoffMs ?? 0,
      };
    }
    return base;
  });

  const edges: EngineEdge[] = canvas.edges.map((e) => ({
    from: e.source,
    on: e.data?.signal ?? "::SCRIPT.NEXT",
    to: e.target,
    kind: e.data?.kind,
    maxIterations: e.data?.maxIterations,
  }));

  return { states, edges };
}
