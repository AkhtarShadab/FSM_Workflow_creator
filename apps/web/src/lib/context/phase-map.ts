/**
 * State 0 phase-map builder (FeatureShipping 011 T1 / design plan §7.1).
 *
 * Emits cluster labels, one-line summaries, and state counts — never tool
 * schemas or system prompts. Hard-capped at 400 tokens; overflow drops the
 * lowest-priority (farthest from START) clusters and appends `+N more clusters`.
 */

export const PHASE_MAP_BUDGET = 400;

export interface FsmDslState {
  id: string;
  type: string;
  label?: string;
  description?: string;
  transitions?: Array<{ on?: string; to: string }>;
  tool?: { name?: string; schema?: unknown; language?: string };
  llm?: { systemPrompt?: string; model?: string; outputSchema?: unknown };
  checkpoint?: {
    enabledStateIds?: string[];
    disabledStateIds?: string[];
    dehydrateClusters?: string[];
    hydrateCluster?: string;
    summaryStrategy?: "template" | "llm";
  };
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface FsmDslCluster {
  id: string;
  label: string;
  states: string[];
  summary?: string;
}

export interface FsmDsl {
  name?: string;
  clusters?: FsmDslCluster[];
  states: FsmDslState[];
}

/** Optional memory-graph table of contents from 002; omitted when absent. */
export interface MemoryToc {
  text?: string;
  entries?: Array<{ id: string; label: string; kind?: string }>;
}

export interface PhaseMapCluster {
  id: string;
  label: string;
  summary: string;
  stateCount: number;
}

export interface PhaseMap {
  clusters: PhaseMapCluster[];
  memoryToc?: string;
  estimatedTokens: number;
  /** Clusters dropped to stay within budget; serialized as `+N more clusters`. */
  overflowCount?: number;
}

/** ~4 chars / token — conservative vs cl100k so the cap does not under-count. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function formatPhaseMap(
  map: Pick<PhaseMap, "clusters" | "memoryToc" | "overflowCount">
): string {
  const lines = ["Phase map:"];
  for (const c of map.clusters) {
    lines.push(formatClusterLine(c));
  }
  if (map.overflowCount && map.overflowCount > 0) {
    lines.push(`+${map.overflowCount} more clusters`);
  }
  if (map.memoryToc) {
    lines.push("Memory:");
    lines.push(map.memoryToc);
  }
  return lines.join("\n");
}

function formatClusterLine(c: PhaseMapCluster): string {
  const head = `- ${c.id}: ${c.label} (${c.stateCount} states)`;
  return c.summary ? `${head}: ${c.summary}` : head;
}

export function engineGraphToDsl(
  states: ReadonlyArray<{
    id: string;
    type: string;
    label?: string;
    mask?: { enabledStateIds?: string[]; disabledStateIds?: string[] };
  }>,
  edges: ReadonlyArray<{ from: string; on?: string; to: string }>
): FsmDsl {
  return {
    states: states.map((s) => ({
      id: s.id,
      type: s.type,
      label: s.label,
      transitions: edges
        .filter((e) => e.from === s.id)
        .map((e) => ({ on: e.on ?? "", to: e.to })),
      checkpoint: s.mask
        ? {
            enabledStateIds: s.mask.enabledStateIds ?? [],
            disabledStateIds: s.mask.disabledStateIds ?? [],
          }
        : undefined,
    })),
  };
}

export function buildPhaseMap(
  dsl: FsmDsl,
  memo?: MemoryToc,
  budget = PHASE_MAP_BUDGET
): PhaseMap {
  const all = discoverClusters(dsl).map((c) => ({
    ...c,
    summary: oneLine(c.summary),
    label: oneLine(c.label, 80),
  }));
  const memoryToc = memoryTocText(memo);
  return packToBudget(all, memoryToc, budget);
}

function packToBudget(
  all: PhaseMapCluster[],
  memoryToc: string | undefined,
  budget: number
): PhaseMap {
  let kept = all.slice();
  let overflow = 0;
  let includeMem = Boolean(memoryToc);

  const snapshot = (): PhaseMap => {
    const mem = includeMem ? memoryToc : undefined;
    const overflowCount = overflow > 0 ? overflow : undefined;
    const text = formatPhaseMap({
      clusters: kept,
      memoryToc: mem,
      overflowCount,
    });
    return {
      clusters: kept,
      memoryToc: mem,
      estimatedTokens: estimateTokens(text),
      overflowCount,
    };
  };

  let map = snapshot();
  while (map.estimatedTokens > budget && kept.length > 0) {
    kept = kept.slice(0, -1);
    overflow += 1;
    map = snapshot();
  }

  // Memory is optional — drop it before shrinking the last cluster.
  if (map.estimatedTokens > budget && includeMem) {
    includeMem = false;
    map = snapshot();
  }

  // Last resort: shorten the remaining cluster's one-line summary rather than
  // slicing the cluster list mid-entry.
  while (
    map.estimatedTokens > budget &&
    kept.length === 1 &&
    kept[0] &&
    kept[0].summary.length > 0
  ) {
    const nextLen = Math.max(0, Math.floor(kept[0].summary.length / 2) - 1);
    kept = [
      {
        ...kept[0],
        summary: nextLen > 0 ? oneLine(kept[0].summary, nextLen) : "",
      },
    ];
    map = snapshot();
  }

  return map;
}

function discoverClusters(dsl: FsmDsl): PhaseMapCluster[] {
  const states = dsl.states ?? [];
  const byId = new Map(states.map((s) => [s.id, s]));
  const transitions = collectTransitions(states);

  if (dsl.clusters && dsl.clusters.length > 0) {
    return dsl.clusters.map((c, i) => {
      const members = c.states.map((id) => byId.get(id)).filter(Boolean) as FsmDslState[];
      return {
        id: c.id || `c${i}`,
        label: c.label || `Phase ${i + 1}`,
        summary: c.summary?.trim() || summarizeStates(members),
        stateCount: c.states.length,
      };
    });
  }

  const startId = states.find((s) => s.type === "START")?.id;
  const dist = distancesFrom(startId, states.map((s) => s.id), transitions);
  const sysFuncs = states
    .filter((s) => s.type === "SYSTEM_FUNCTION")
    .sort((a, b) => (dist.get(a.id) ?? 1e9) - (dist.get(b.id) ?? 1e9));

  const grouped = new Set<string>();
  const fromMask: PhaseMapCluster[] = [];
  for (const sf of sysFuncs) {
    const ids = (sf.checkpoint?.enabledStateIds ?? []).filter((id) => byId.has(id));
    if (ids.length === 0) continue;
    const members = ids.map((id) => byId.get(id)!);
    fromMask.push({
      id: sf.id,
      label: sf.label || `Phase ${fromMask.length + 1}`,
      summary: summarizeStates(members),
      stateCount: ids.length,
    });
    for (const id of ids) grouped.add(id);
  }

  const remaining = states.filter(
    (s) => s.type !== "SYSTEM_FUNCTION" && !grouped.has(s.id)
  );
  const ccs = connectedComponents(
    remaining.map((s) => s.id),
    transitions
  );
  ccs.sort((a, b) => {
    const da = Math.min(...a.map((id) => dist.get(id) ?? 1e9));
    const db = Math.min(...b.map((id) => dist.get(id) ?? 1e9));
    return da - db;
  });

  const fromCc: PhaseMapCluster[] = ccs.map((ids, i) => {
    const members = ids.map((id) => byId.get(id)!);
    const first = members[0];
    return {
      id: first?.id ?? `c${i}`,
      label: first?.label || `Phase ${fromMask.length + i + 1}`,
      summary: summarizeStates(members),
      stateCount: ids.length,
    };
  });

  // Mask groupings sit at their SYS_FUNC boundary; leftover CCs keep START-order.
  return interleaveByDistance(fromMask, fromCc, dist, byId);
}

function interleaveByDistance(
  fromMask: PhaseMapCluster[],
  fromCc: PhaseMapCluster[],
  dist: Map<string, number>,
  byId: Map<string, FsmDslState>
): PhaseMapCluster[] {
  const clusterDist = (c: PhaseMapCluster): number => {
    const sf = byId.get(c.id);
    if (sf) return dist.get(sf.id) ?? 1e9;
    return dist.get(c.id) ?? 1e9;
  };
  return [...fromMask, ...fromCc].sort((a, b) => clusterDist(a) - clusterDist(b));
}

function collectTransitions(
  states: FsmDslState[]
): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const s of states) {
    for (const t of s.transitions ?? []) {
      if (t.to) edges.push({ from: s.id, to: t.to });
    }
  }
  return edges;
}

function distancesFrom(
  startId: string | undefined,
  ids: string[],
  edges: Array<{ from: string; to: string }>
): Map<string, number> {
  const dist = new Map<string, number>();
  ids.forEach((id, i) => dist.set(id, 10_000 + i));
  if (!startId) return dist;
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from);
    if (list) list.push(e.to);
    else adj.set(e.from, [e.to]);
  }
  dist.set(startId, 0);
  const q = [startId];
  while (q.length) {
    const cur = q.shift()!;
    const d = dist.get(cur) ?? 0;
    for (const n of adj.get(cur) ?? []) {
      if ((dist.get(n) ?? 1e9) <= d + 1) continue;
      dist.set(n, d + 1);
      q.push(n);
    }
  }
  return dist;
}

function connectedComponents(
  vertexIds: string[],
  edges: Array<{ from: string; to: string }>
): string[][] {
  const verts = new Set(vertexIds);
  const adj = new Map<string, string[]>();
  for (const id of vertexIds) adj.set(id, []);
  for (const e of edges) {
    if (!verts.has(e.from) || !verts.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  const seen = new Set<string>();
  const ccs: string[][] = [];
  for (const id of vertexIds) {
    if (seen.has(id)) continue;
    const stack = [id];
    const cc: string[] = [];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      cc.push(cur);
      for (const n of adj.get(cur) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    ccs.push(cc);
  }
  return ccs;
}

function summarizeStates(members: FsmDslState[]): string {
  const descriptions = members
    .map((s) => s.description?.replace(/\s+/g, " ").trim())
    .filter((d): d is string => Boolean(d));
  if (descriptions[0]) return descriptions[0];
  const labels = members
    .map((s) => s.label?.trim() || s.id)
    .filter(Boolean)
    .slice(0, 4);
  return labels.join(", ");
}

function oneLine(text: string, max = 160): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  return `${line.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function memoryTocText(memo?: MemoryToc): string | undefined {
  if (!memo) return undefined;
  if (memo.text?.trim()) return oneLine(memo.text, 240);
  if (memo.entries && memo.entries.length > 0) {
    return memo.entries
      .slice(0, 12)
      .map((e) => `- ${e.id}: ${e.label}`)
      .join("\n");
  }
  return undefined;
}
