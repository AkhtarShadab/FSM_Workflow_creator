import type { EngineState, StateExecutor } from "@fsm/engine";
import type { SignalOverrides } from "@/lib/templates/types";

/** Default success signal a stubbed state emits (no live executors yet). */
export function defaultStubSignal(type: string): string {
  switch (type) {
    case "HTTP":
      return "::HTTP.NEXT";
    case "VALIDATE":
      return "::VALIDATE.NEXT";
    case "AI":
      return "::AI.NEXT";
    case "EXTERNAL_AI":
      return "::EXTERNAL_AI.NEXT";
    case "HUMAN":
      // Live human bridge is future work — default auto-approve
      return "::HUMAN.APPROVE";
    case "SYSTEM_FUNCTION":
      return "::SYSTEM.HYDRATE";
    default:
      return "::SCRIPT.NEXT";
  }
}

/**
 * Stub executor for platform dry runs. `overrides[stateId]` lists the
 * signals that state emits on its 1st, 2nd, … visit; once exhausted it falls
 * back to the default success signal. Lets a demo walk every branch
 * (rejections, retries, outages) without live AI / HTTP executors.
 */
export function createStubExecutor(overrides: SignalOverrides = {}): StateExecutor {
  const visits = new Map<string, number>();
  return async ({ state }: { state: EngineState }) => {
    const n = visits.get(state.id) ?? 0;
    visits.set(state.id, n + 1);
    const scripted = overrides[state.id];
    if (scripted && n < scripted.length && scripted[n]) return scripted[n];
    return defaultStubSignal(state.type);
  };
}

/** Validate untrusted override input from the API body. */
export function parseOverrides(raw: unknown): SignalOverrides | null {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: SignalOverrides = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 200) return null;
  for (const [stateId, list] of entries) {
    if (!Array.isArray(list) || list.length > 50) return null;
    if (!list.every((s) => typeof s === "string" && s.startsWith("::") && s.length <= 128)) {
      return null;
    }
    out[stateId] = list as string[];
  }
  return out;
}
