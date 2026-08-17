/**
 * SYSTEM_FUNCTION checkpoint boundary (FeatureShipping 011 T2 / design plan §7.2).
 *
 * Dehydrate finished-cluster history → mask-swap tool schemas → hydrate
 * (summary + phase map + next schemas) and resume on ::SYSTEM.HYDRATE.
 *
 * Checkpoints persist to the SB0 `checkpoints` table. This module does not
 * add columns; oversized history is spilled via a `chunkRef` pointer stored
 * inside the existing `historyJson` text.
 */

import {
  swapToolSchemas,
  type MaskSwapResult,
  type ToolSchema,
} from "@fsm/engine";
import {
  estimateTokens,
  formatPhaseMap,
  type FsmDsl,
  type FsmDslState,
  type PhaseMap,
} from "./phase-map";

export const LLM_SUMMARY_TOKEN_CAP = 500;
export const TEMPLATE_FIRST_N = 3;
export const TEMPLATE_LAST_N = 3;
export const TEMPLATE_MESSAGE_CHARS = 240;
export const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000;
export const HISTORY_JSON_MAX_BYTES = 1024 * 1024;

export interface HistoryMessage {
  stateId: string;
  role?: "system" | "user" | "assistant" | "tool";
  content: string;
  vars?: Record<string, string>;
}

export type LlmSummarizer = (input: {
  history: HistoryMessage[];
  vars: Record<string, string>;
  maxTokens: number;
  signal?: AbortSignal;
}) => Promise<string>;

export interface CheckpointRecord {
  id?: number;
  runId: number;
  stateId: string;
  key: string;
  summary: string;
  historyJson: string;
  tokensSaved: number;
  createdAt: Date;
  expiresAt: Date;
}

export interface CheckpointStore {
  insert(row: Omit<CheckpointRecord, "id">): Promise<CheckpointRecord>;
  getByKey?(key: string): Promise<CheckpointRecord | null>;
}

export interface MemoryCheckpointStore extends CheckpointStore {
  rows: CheckpointRecord[];
}

export function createMemoryCheckpointStore(): MemoryCheckpointStore {
  const rows: CheckpointRecord[] = [];
  let nextId = 1;
  return {
    rows,
    async insert(row) {
      const record: CheckpointRecord = { ...row, id: nextId++ };
      rows.push(record);
      return record;
    },
    async getByKey(key) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].key === key) return rows[i] ?? null;
      }
      return null;
    },
  };
}

export function checkpointKey(runId: number, seq: number): string {
  return `run:${runId}:cp:${seq}`;
}

/** Primitive vars extracted in encounter order; later values overwrite. */
export function extractVars(
  history: readonly HistoryMessage[]
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const msg of history) {
    if (msg.vars) {
      for (const [k, v] of Object.entries(msg.vars)) {
        if (v != null && v !== "") vars[k] = String(v);
      }
    }
    Object.assign(vars, varsFromContent(msg.content));
  }
  return sortRecord(vars);
}

function varsFromContent(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const trimmed = content.trim();
  if (!trimmed) return out;

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      collectPrimitiveFields(parsed, out);
    } catch {
      /* not JSON — fall through to kv scan */
    }
  }

  const kv = /(?:^|\s|,|\|)([A-Za-z_][A-Za-z0-9_]*)=([^\s|,]+)/g;
  let m: RegExpExecArray | null;
  while ((m = kv.exec(content))) {
    const key = m[1];
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function collectPrimitiveFields(
  value: unknown,
  out: Record<string, string>,
  prefix = ""
): void {
  if (value == null) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (prefix) out[prefix] = String(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) =>
      collectPrimitiveFields(item, out, prefix ? `${prefix}.${i}` : String(i))
    );
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v != null && typeof v !== "object") out[path] = String(v);
      else if (v && typeof v === "object" && !Array.isArray(v) && prefix === "") {
        collectPrimitiveFields(v, out, k);
      }
    }
  }
}

function sortRecord(vars: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(vars).sort()) sorted[k] = vars[k];
  return sorted;
}

function formatVarsLine(vars: Record<string, string>): string {
  const keys = Object.keys(vars);
  if (keys.length === 0) return "vars: (none)";
  return `vars: ${keys.map((k) => `${k}=${vars[k]}`).join("; ")}`;
}

function formatMessage(msg: HistoryMessage, index: number): string {
  const role = msg.role ?? "tool";
  const body = clipLine(msg.content, TEMPLATE_MESSAGE_CHARS);
  return `[${index}] ${msg.stateId} ${role}: ${body}`;
}

function clipLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  return `${line.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Deterministic template summarizer: first/last N messages plus extracted vars.
 * Zero-cost default (Q11).
 */
export function summarizeTemplate(
  history: readonly HistoryMessage[],
  opts?: { firstN?: number; lastN?: number }
): string {
  const firstN = opts?.firstN ?? TEMPLATE_FIRST_N;
  const lastN = opts?.lastN ?? TEMPLATE_LAST_N;
  const vars = extractVars(history);
  const lines = ["# template summary", formatVarsLine(vars)];

  if (history.length === 0) {
    lines.push("messages: (none)");
    return lines.join("\n");
  }

  if (history.length <= firstN + lastN) {
    lines.push("messages:");
    history.forEach((msg, i) => lines.push(formatMessage(msg, i)));
    return lines.join("\n");
  }

  lines.push(`first ${firstN}:`);
  history.slice(0, firstN).forEach((msg, i) => lines.push(formatMessage(msg, i)));
  lines.push(`last ${lastN}:`);
  const lastStart = history.length - lastN;
  history.slice(lastStart).forEach((msg, i) =>
    lines.push(formatMessage(msg, lastStart + i))
  );
  return lines.join("\n");
}

/** Truncate so `estimateTokens(text) <= maxTokens` (4 chars / token). */
export function capTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  const sliced = text.slice(0, maxChars);
  const nl = sliced.lastIndexOf("\n");
  const cut = nl > maxChars / 2 ? sliced.slice(0, nl) : sliced;
  return estimateTokens(cut) <= maxTokens ? cut : cut.slice(0, maxChars);
}

export async function summarizeWithStrategy(
  history: readonly HistoryMessage[],
  strategy: "template" | "llm",
  opts?: { llm?: LlmSummarizer; signal?: AbortSignal }
): Promise<{
  summary: string;
  strategy: "template" | "llm";
  warning?: string;
}> {
  if (strategy !== "llm") {
    return { summary: summarizeTemplate(history), strategy: "template" };
  }
  if (!opts?.llm) {
    return {
      summary: summarizeTemplate(history),
      strategy: "template",
      warning: "llm summarizer unavailable; fell back to template",
    };
  }
  try {
    const raw = await opts.llm({
      history: [...history],
      vars: extractVars(history),
      maxTokens: LLM_SUMMARY_TOKEN_CAP,
      signal: opts.signal,
    });
    return {
      summary: capTokens(raw ?? "", LLM_SUMMARY_TOKEN_CAP),
      strategy: "llm",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      summary: summarizeTemplate(history),
      strategy: "template",
      warning: `llm summarizer failed; fell back to template: ${message}`,
    };
  }
}

export function collectToolSchemas(
  dsl: FsmDsl,
  stateIds: readonly string[]
): ToolSchema[] {
  const want = new Set(stateIds);
  const out: ToolSchema[] = [];
  for (const s of dsl.states ?? []) {
    if (!want.has(s.id)) continue;
    if (s.tool?.name) {
      out.push({
        name: s.tool.name,
        schema: s.tool.schema ?? s.inputSchema,
        stateId: s.id,
      });
    }
  }
  return out;
}

export function memberIdsForCluster(dsl: FsmDsl, clusterId: string): string[] {
  const named = (dsl.clusters ?? []).find((c) => c.id === clusterId);
  if (named) return [...named.states];
  const sf = (dsl.states ?? []).find(
    (s) => s.id === clusterId && s.type === "SYSTEM_FUNCTION"
  );
  const enabled = sf?.checkpoint?.enabledStateIds;
  if (enabled && enabled.length > 0) return [...enabled];
  if ((dsl.states ?? []).some((s) => s.id === clusterId)) return [clusterId];
  return [];
}

export function resolveClusterStateIds(args: {
  dsl: FsmDsl;
  stateId: string;
  history: readonly HistoryMessage[];
  dehydrateClusters?: string[];
  hydrateCluster?: string;
  enabledStateIds?: string[];
}): { finishedStateIds: string[]; nextStateIds: string[] } {
  const visited = unique(
    args.history.map((m) => m.stateId).filter((id) => !isBoundaryState(args.dsl, id))
  );

  const nextFromHydrate = args.hydrateCluster
    ? memberIdsForCluster(args.dsl, args.hydrateCluster)
    : [];
  const nextStateIds =
    nextFromHydrate.length > 0
      ? nextFromHydrate
      : args.enabledStateIds && args.enabledStateIds.length > 0
        ? [...args.enabledStateIds]
        : [];

  const finishedFromNamed = (args.dehydrateClusters ?? []).flatMap((id) =>
    memberIdsForCluster(args.dsl, id)
  );
  const finishedStateIds =
    finishedFromNamed.length > 0
      ? unique(finishedFromNamed)
      : nextStateIds.length > 0
        ? visited.filter((id) => !nextStateIds.includes(id))
        : visited;

  return { finishedStateIds, nextStateIds };
}

function isBoundaryState(dsl: FsmDsl, id: string): boolean {
  const t = dsl.states.find((s) => s.id === id)?.type;
  return t === "START" || t === "END" || t === "SYSTEM_FUNCTION";
}

function unique(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function filterHistory(
  history: readonly HistoryMessage[],
  stateIds: readonly string[]
): HistoryMessage[] {
  if (stateIds.length === 0) return [...history];
  const want = new Set(stateIds);
  return history.filter((m) => want.has(m.stateId));
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export interface SpilledHistory {
  chunkRef: string;
  spilled: true;
  bytes: number;
}

export function isSpilledHistory(value: unknown): value is SpilledHistory {
  return (
    !!value &&
    typeof value === "object" &&
    (value as SpilledHistory).spilled === true &&
    typeof (value as SpilledHistory).chunkRef === "string"
  );
}

export function encodeHistoryJson(
  history: readonly HistoryMessage[],
  key: string
): { historyJson: string; spilled: boolean } {
  const json = JSON.stringify(history);
  if (utf8Bytes(json) <= HISTORY_JSON_MAX_BYTES) {
    return { historyJson: json, spilled: false };
  }
  const pointer: SpilledHistory = {
    chunkRef: `${key}:history`,
    spilled: true,
    bytes: utf8Bytes(json),
  };
  return { historyJson: JSON.stringify(pointer), spilled: true };
}

export function parseStoredHistory(historyJson: string): {
  history: HistoryMessage[] | null;
  spilled: boolean;
} {
  try {
    const parsed: unknown = JSON.parse(historyJson);
    if (isSpilledHistory(parsed)) return { history: null, spilled: true };
    if (Array.isArray(parsed)) return { history: parsed as HistoryMessage[], spilled: false };
  } catch {
    /* ignore */
  }
  return { history: null, spilled: false };
}

export function formatHydrateContext(args: {
  summary: string;
  phaseMap?: PhaseMap;
  nextSchemas: readonly ToolSchema[];
  lossy?: boolean;
}): string {
  const parts: string[] = [];
  if (args.lossy) {
    parts.push("lossy: summary-only (checkpoint expired or spilled)");
  }
  parts.push("Checkpoint summary:");
  parts.push(args.summary);
  if (args.phaseMap) {
    parts.push("");
    parts.push(formatPhaseMap(args.phaseMap));
  }
  if (args.nextSchemas.length > 0) {
    parts.push("");
    parts.push("Next cluster schemas:");
    for (const s of args.nextSchemas) {
      const schema =
        s.schema !== undefined ? ` ${JSON.stringify(s.schema)}` : "";
      parts.push(`- ${s.name}${s.stateId ? ` (${s.stateId})` : ""}:${schema}`);
    }
  }
  return parts.join("\n");
}

export interface HydrateResult {
  text: string;
  context: HistoryMessage[];
  storedHistory: HistoryMessage[] | null;
  tokensSaved: number;
  lossy: boolean;
}

export function hydrate(args: {
  record: CheckpointRecord;
  phaseMap?: PhaseMap;
  nextSchemas: readonly ToolSchema[];
  now?: Date;
  /** Original finished-cluster history, used when measuring tokensSaved. */
  finishedHistory?: readonly HistoryMessage[];
}): HydrateResult {
  const now = args.now ?? new Date();
  const expired = args.record.expiresAt.getTime() <= now.getTime();
  const parsed = parseStoredHistory(args.record.historyJson);
  const lossy = expired || parsed.spilled;
  const storedHistory = expired ? null : parsed.history;
  const text = formatHydrateContext({
    summary: args.record.summary,
    phaseMap: args.phaseMap,
    nextSchemas: args.nextSchemas,
    lossy,
  });
  const finished =
    args.finishedHistory ?? storedHistory ?? [];
  const before = estimateTokens(
    finished.length > 0 ? JSON.stringify(finished) : args.record.historyJson
  );
  const after = estimateTokens(text);
  const tokensSaved = Math.max(0, before - after);
  return {
    text,
    context: [
      {
        stateId: args.record.stateId,
        role: "system",
        content: text,
      },
    ],
    storedHistory,
    tokensSaved,
    lossy,
  };
}

export interface DehydrateResult {
  record: CheckpointRecord;
  summary: string;
  strategy: "template" | "llm";
  warning?: string;
  finishedHistory: HistoryMessage[];
}

export async function dehydrate(args: {
  runId: number;
  stateId: string;
  seq: number;
  history: readonly HistoryMessage[];
  finishedStateIds: readonly string[];
  strategy: "template" | "llm";
  llm?: LlmSummarizer;
  now?: Date;
  store?: CheckpointStore;
  signal?: AbortSignal;
}): Promise<DehydrateResult> {
  const now = args.now ?? new Date();
  const finishedHistory = filterHistory(args.history, args.finishedStateIds);
  const summarized = await summarizeWithStrategy(finishedHistory, args.strategy, {
    llm: args.llm,
    signal: args.signal,
  });
  const key = checkpointKey(args.runId, args.seq);
  const { historyJson } = encodeHistoryJson(finishedHistory, key);
  const before = estimateTokens(JSON.stringify(finishedHistory));
  const after = estimateTokens(summarized.summary);
  const tokensSaved = Math.max(0, before - after);
  let record: CheckpointRecord = {
    runId: args.runId,
    stateId: args.stateId,
    key,
    summary: summarized.summary,
    historyJson,
    tokensSaved,
    createdAt: now,
    expiresAt: new Date(now.getTime() + CHECKPOINT_TTL_MS),
  };
  let warning = summarized.warning;
  if (args.store) {
    try {
      record = await args.store.insert(record);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warning = warning
        ? `${warning}; checkpoint persist failed: ${message}`
        : `checkpoint persist failed: ${message}`;
    }
  }
  return {
    record,
    summary: summarized.summary,
    strategy: summarized.strategy,
    warning,
    finishedHistory,
  };
}

export interface CheckpointBoundaryResult {
  record: CheckpointRecord;
  mask: MaskSwapResult;
  hydrated: HydrateResult;
  warning?: string;
  emission: {
    signal: "::SYSTEM.HYDRATE";
    payload: {
      checkpoint_id: string;
      tokensSaved: number;
      unloaded: string[];
      loaded: string[];
      lossy: boolean;
      strategy: "template" | "llm";
    };
  };
}

export async function runCheckpointBoundary(args: {
  runId: number;
  stateId: string;
  seq: number;
  history: readonly HistoryMessage[];
  dsl: FsmDsl;
  phaseMap?: PhaseMap;
  currentSchemas?: readonly ToolSchema[];
  dehydrateClusters?: string[];
  hydrateCluster?: string;
  enabledStateIds?: string[];
  strategy: "template" | "llm";
  llm?: LlmSummarizer;
  store?: CheckpointStore;
  now?: Date;
  signal?: AbortSignal;
}): Promise<CheckpointBoundaryResult> {
  const clusters = resolveClusterStateIds({
    dsl: args.dsl,
    stateId: args.stateId,
    history: args.history,
    dehydrateClusters: args.dehydrateClusters,
    hydrateCluster: args.hydrateCluster,
    enabledStateIds: args.enabledStateIds,
  });
  const finishedSchemas = collectToolSchemas(args.dsl, clusters.finishedStateIds);
  const nextSchemas = collectToolSchemas(args.dsl, clusters.nextStateIds);
  const current =
    args.currentSchemas && args.currentSchemas.length > 0
      ? args.currentSchemas
      : finishedSchemas;

  const dehydrated = await dehydrate({
    runId: args.runId,
    stateId: args.stateId,
    seq: args.seq,
    history: args.history,
    finishedStateIds: clusters.finishedStateIds,
    strategy: args.strategy,
    llm: args.llm,
    now: args.now,
    store: args.store,
    signal: args.signal,
  });

  const mask = swapToolSchemas(current, finishedSchemas, nextSchemas);
  const hydrated = hydrate({
    record: dehydrated.record,
    phaseMap: args.phaseMap,
    nextSchemas: mask.loaded,
    now: args.now,
    finishedHistory: dehydrated.finishedHistory,
  });

  // Persist tokensSaved from the hydrate measurement when it's larger
  // (compact context vs raw finished history).
  if (hydrated.tokensSaved > dehydrated.record.tokensSaved) {
    dehydrated.record.tokensSaved = hydrated.tokensSaved;
  }

  return {
    record: dehydrated.record,
    mask,
    hydrated,
    warning: dehydrated.warning,
    emission: {
      signal: "::SYSTEM.HYDRATE",
      payload: {
        checkpoint_id: dehydrated.record.key,
        tokensSaved: dehydrated.record.tokensSaved,
        unloaded: mask.unloaded.map((s) => s.name),
        loaded: mask.loaded.map((s) => s.name),
        lossy: hydrated.lossy,
        strategy: dehydrated.strategy,
      },
    },
  };
}

export function checkpointConfigFromState(state: FsmDslState | undefined): {
  summaryStrategy: "template" | "llm";
  dehydrateClusters?: string[];
  hydrateCluster?: string;
  enabledStateIds?: string[];
} {
  const cp = state?.checkpoint;
  return {
    summaryStrategy: cp?.summaryStrategy === "llm" ? "llm" : "template",
    dehydrateClusters: cp?.dehydrateClusters,
    hydrateCluster: cp?.hydrateCluster,
    enabledStateIds: cp?.enabledStateIds,
  };
}
