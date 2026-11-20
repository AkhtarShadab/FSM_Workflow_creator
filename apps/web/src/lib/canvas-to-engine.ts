import type { EngineEdge, EngineState } from "@fsm/engine";
import {
  normalizeEdgeData,
  normalizeSpawn,
  normalizeSystemFunction,
  spawnWorkerCount,
  type CanvasData,
} from "@/lib/fsm-types";

/** Pure canvas → @fsm/engine mapping (no DB; unit-testable). */
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
      guardrails: n.data.guardrails,
    };
    if (n.data.inputSchema) {
      try {
        base.inputSchema = JSON.parse(n.data.inputSchema);
      } catch {
        /* ignore */
      }
    }
    if (n.data.stateType === "SYSTEM_FUNCTION") {
      const sf = normalizeSystemFunction(n.data.systemFunction);
      base.mask = {
        enabledStateIds: sf.enabledStateIds,
        disabledStateIds: sf.disabledStateIds,
        rewire: sf.rewire,
      };
    }
    if (n.data.stateType === "SPAWN") {
      const spawn = normalizeSpawn(n.data.spawn);
      base.spawn = {
        mode: spawn.mode,
        count: spawnWorkerCount(spawn),
        maxConcurrency: spawn.maxConcurrency,
        strategy: spawn.strategy,
        quorumK: spawn.quorumK,
        cancelOnParentHalt: spawn.cancelOnParentHalt,
        profiles: spawn.profiles.map((p) => ({
          id: p.id,
          toolPack: p.toolPack,
          skillPack: p.skillPack,
          // Fall back to the SPAWN state's guardrail timeout (what the DSL emits)
          timeoutMs: p.timeoutMs ?? n.data.guardrails?.timeoutMs,
        })),
      };
    }
    if (n.data.stateType === "VALIDATE" && n.data.validate?.kind !== "predicate") {
      try {
        base.inputSchema = n.data.validate.schema
          ? JSON.parse(n.data.validate.schema)
          : { type: "object" };
      } catch {
        base.inputSchema = { type: "object" };
      }
    }
    return base;
  });

  // Normalise like canvasToDsl/lintCanvas so legacy edges (no kind, or
  // source === target without maxIterations) get the same defaults.
  const edges: EngineEdge[] = canvas.edges.map((e) => {
    const data = normalizeEdgeData(e.data, e.source, e.target);
    return {
      from: e.source,
      on: data.signal,
      to: e.target,
      kind: data.kind,
      maxIterations: data.maxIterations,
    };
  });

  return { states, edges };
}
