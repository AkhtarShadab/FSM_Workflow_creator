import { isStateDisabledByMask } from "./mask";
import { parseSignal, type Emission, type ParsedSignal } from "./signals";

export interface EngineEdge {
  from: string;
  on: string;
  to: string;
  kind?: "transition" | "self-loop" | "router";
  maxIterations?: number;
}

export interface EngineMask {
  enabledStateIds: string[];
  disabledStateIds: string[];
  rewire: Array<{ from: string; on: string; to: string }>;
}

export type ResolveOk = {
  ok: true;
  to: string;
  signal: string;
  payload: Record<string, unknown>;
};

export type ResolveErr = {
  ok: false;
  code: "transition_error" | "toHint_mismatch";
  message: string;
  signal: string;
};

export type ResolveResult = ResolveOk | ResolveErr;

/**
 * Resolve an emission against the outgoing edge allowlist, applying SYS_FUNC
 * rewire + skip-disabled targets (FeatureShipping 001 §3.3–3.4).
 */
export function resolveTransition(args: {
  fromStateId: string;
  emission: Emission;
  edges: EngineEdge[];
  mask?: EngineMask | null;
  /** Max skip hops when chasing next enabled successor */
  maxSkip?: number;
}): ResolveResult {
  const parsed = parseSignal(args.emission);
  const mask = args.mask ?? null;
  const maxSkip = args.maxSkip ?? 32;

  const effectiveEdges = applyRewire(args.edges, mask);

  const matching = effectiveEdges.filter(
    (e) => e.from === args.fromStateId && e.on === parsed.signal
  );
  // Router edges are SYS_FUNC head wiring (§10.2/§10.5), not flow. Prefer
  // real transitions / self-loops so a router wire that happens to share the
  // emitted signal never hijacks the hop; fall back to router edges only when
  // nothing else matches.
  const flow = matching.filter((e) => e.kind !== "router");
  const candidates = flow.length > 0 ? flow : matching;

  if (candidates.length === 0) {
    return {
      ok: false,
      code: "transition_error",
      message: `No allowlisted edge for signal ${parsed.signal} from ${args.fromStateId}`,
      signal: parsed.signal,
    };
  }

  let target = candidates[0].to;

  if (parsed.toHint) {
    const hinted = candidates.find((c) => c.to === parsed.toHint);
    if (!hinted) {
      return {
        ok: false,
        code: "toHint_mismatch",
        message: `toHint ${parsed.toHint} is not in the allowlist for ${parsed.signal}`,
        signal: parsed.signal,
      };
    }
    target = hinted.to;
  }

  target = skipDisabled(target, parsed, effectiveEdges, mask, maxSkip);

  if (mask && isStateDisabledByMask(target, mask)) {
    return {
      ok: false,
      code: "transition_error",
      message: `Resolved target ${target} is disabled by SYS_FUNC mask with no enabled successor`,
      signal: parsed.signal,
    };
  }

  return {
    ok: true,
    to: target,
    signal: parsed.signal,
    payload: parsed.payload,
  };
}

function applyRewire(
  edges: EngineEdge[],
  mask: EngineMask | null
): EngineEdge[] {
  if (!mask || mask.rewire.length === 0) return edges;
  const out = edges.map((e) => ({ ...e }));
  for (const r of mask.rewire) {
    const idx = out.findIndex((e) => e.from === r.from && e.on === r.on);
    if (idx >= 0) out[idx] = { from: r.from, on: r.on, to: r.to };
    else out.push({ from: r.from, on: r.on, to: r.to });
  }
  return out;
}

function skipDisabled(
  target: string,
  parsed: ParsedSignal,
  edges: EngineEdge[],
  mask: EngineMask | null,
  maxSkip: number
): string {
  if (!mask) return target;
  let cur = target;
  let hops = 0;
  while (isStateDisabledByMask(cur, mask) && hops < maxSkip) {
    const outs = edges.filter((e) => e.from === cur && e.kind !== "router");
    const next = outs.find((e) => e.on === parsed.signal);
    if (!next) {
      // try any outgoing (non-router) edge from the disabled node
      const any = outs[0];
      if (!any) break;
      cur = any.to;
    } else {
      cur = next.to;
    }
    hops += 1;
  }
  return cur;
}
