import type { Edge, Node } from "@xyflow/react";

/** FSM state types per DETAILED_DESIGN_PLAN §2 */
export type FSMStateType =
  | "START"
  | "SCRIPT"
  | "AI"
  | "SPAWN"
  | "AGGREGATE"
  | "SYSTEM_FUNCTION"
  | "END";

export type ToolLanguage = "python" | "cpp" | "bash";

/** Card 1 — deterministic execution config (§10.3) */
export interface ScriptConfig {
  toolName: string;
  language: ToolLanguage;
  code: string;
}

/** Card 2 — generative instructions config (§10.3) */
export interface AIConfig {
  credentialId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  outputSchema: string;
}

/** Card 3 — guardrails & fallback logic (§10.3) */
export interface GuardrailConfig {
  timeoutMs: number;
  retryMax: number;
  retryBackoffMs: number;
}

export type AggregationStrategy = "waitAll" | "quorum" | "firstSuccess";

/** Per-child tool/skill/model profile (FeatureShipping 001 §3.8) */
export interface ChildProfile {
  id: string;
  childFsm: string;
  toolPack: string[];
  skillPack: string[];
  credentialId?: string;
  modelId?: string;
  inputMap?: Record<string, string>;
  timeoutMs?: number;
}

/** SPAWN config v2 — parallel workers + packs */
export interface SpawnConfig {
  mode: "homogeneous" | "heterogeneous";
  count: number;
  maxConcurrency: number;
  strategy: AggregationStrategy;
  quorumK?: number;
  cancelOnParentHalt: boolean;
  profiles: ChildProfile[];
  aggregateTo: string;
}

export interface VerifyConfig {
  kind: "schema" | "script";
  scriptRef?: string;
}

export interface OnErrorConfig {
  signal: string;
  to?: string;
}

export interface SystemFunctionConfig {
  summaryStrategy: "template" | "llm";
  /** Types for C1; enable-map UI lands in C2 */
  enabledStateIds: string[];
  disabledStateIds: string[];
  rewire: Array<{ from: string; on: string; to: string }>;
}

/** Data carried by every canvas node */
export interface StateNodeData extends Record<string, unknown> {
  stateType: FSMStateType;
  label: string;
  description: string;
  inputSchema: string;
  outputSchema: string;
  verify: VerifyConfig;
  onError: OnErrorConfig;
  script: ScriptConfig;
  ai: AIConfig;
  guardrails: GuardrailConfig;
  spawn: SpawnConfig;
  systemFunction: SystemFunctionConfig;
}

/** Data carried by every transition edge */
export interface TransitionEdgeData extends Record<string, unknown> {
  signal: string;
}

export type StateNode = Node<StateNodeData, "stateCircle">;
export type TransitionEdge = Edge<TransitionEdgeData>;

export interface CanvasData {
  nodes: StateNode[];
  edges: TransitionEdge[];
}

export type EdgeKind = "script" | "ai" | "system" | "spawn";

/** Map a signal to its visual edge family (§10.2 edge styles) */
export function edgeTypeForSignal(signal: string): EdgeKind {
  if (signal.startsWith("::AI.")) return "ai";
  if (signal.startsWith("::SYSTEM.")) return "system";
  if (signal.startsWith("::SPAWN.")) return "spawn";
  return "script";
}

/** Canonical signal presets grouped by namespace (§6.1) */
export const SIGNAL_PRESETS: { signal: string; kind: EdgeKind; hint: string }[] = [
  { signal: "::SCRIPT.NEXT", kind: "script", hint: "tool exit 0" },
  { signal: "::SCRIPT.ERROR", kind: "script", hint: "tool non-zero / timeout" },
  { signal: "::AI.NEXT", kind: "ai", hint: "transition after generation" },
  { signal: "::AI.GENERATE", kind: "ai", hint: "chained generation" },
  { signal: "::AI.VALIDATION_ERROR", kind: "ai", hint: "schema failure route" },
  { signal: "::SPAWN.SUBAGENTS", kind: "spawn", hint: "fan out child runs" },
  { signal: "::SYSTEM.DEHYDRATE", kind: "system", hint: "persist context slice" },
  { signal: "::SYSTEM.HYDRATE", kind: "system", hint: "load summary + schemas" },
  { signal: "::SYSTEM.HALT", kind: "system", hint: "stop run with checkpoint" },
];

/** Pastel sticky-note palette per state type (shapeof.ai sticky pattern) */
export const STATE_COLORS: Record<
  FSMStateType,
  { note: string; border: string; text: string; tape: string }
> = {
  START: {
    note: "bg-[#d1fae5]",
    border: "border-[#8fdcb4]",
    text: "text-[#1e5c3f]",
    tape: "bg-[#6fcf9f]/50",
  },
  SCRIPT: {
    note: "bg-[#dbeafe]",
    border: "border-[#a5c4f0]",
    text: "text-[#1e4a8a]",
    tape: "bg-[#8fb4ec]/50",
  },
  AI: {
    note: "bg-[#fce7f3]",
    border: "border-[#f0b8d9]",
    text: "text-[#8a2a63]",
    tape: "bg-[#ec9fca]/50",
  },
  SPAWN: {
    note: "bg-[#fef3c7]",
    border: "border-[#e8d189]",
    text: "text-[#7a5410]",
    tape: "bg-[#e3c66e]/50",
  },
  AGGREGATE: {
    note: "bg-[#cffafe]",
    border: "border-[#8fd9e8]",
    text: "text-[#155e70]",
    tape: "bg-[#79cfe3]/50",
  },
  SYSTEM_FUNCTION: {
    note: "bg-[#ede9fe]",
    border: "border-[#c9b8f5]",
    text: "text-[#5b3ea8]",
    tape: "bg-[#b8a4f0]/50",
  },
  END: {
    note: "bg-[#fee2e2]",
    border: "border-[#f0aeae]",
    text: "text-[#8a2e2e]",
    tape: "bg-[#ec9a9a]/50",
  },
};

/** Default signal emitted when connecting FROM a state type (§6.1) */
export const DEFAULT_SIGNALS: Record<FSMStateType, string> = {
  START: "::SCRIPT.NEXT",
  SCRIPT: "::SCRIPT.NEXT",
  AI: "::AI.NEXT",
  SPAWN: "::SPAWN.SUBAGENTS",
  AGGREGATE: "::SCRIPT.NEXT",
  SYSTEM_FUNCTION: "::SYSTEM.HYDRATE",
  END: "::SYSTEM.HALT",
};

export function defaultChildProfile(childFsm = "child-worker"): ChildProfile {
  return {
    id: "default",
    childFsm,
    toolPack: [],
    skillPack: [],
  };
}

export function defaultSpawnConfig(): SpawnConfig {
  return {
    mode: "homogeneous",
    count: 3,
    maxConcurrency: 2,
    strategy: "waitAll",
    cancelOnParentHalt: true,
    profiles: [defaultChildProfile()],
    aggregateTo: "",
  };
}

/** Normalize persisted / legacy spawn shapes to SpawnConfig v2 */
export function normalizeSpawn(raw: unknown): SpawnConfig {
  const base = defaultSpawnConfig();
  if (!raw || typeof raw !== "object") return base;
  const s = raw as Record<string, unknown>;

  // Legacy v1: { childFsm, count, strategy }
  if (!("profiles" in s) && typeof s.childFsm === "string") {
    return {
      ...base,
      count: typeof s.count === "number" ? s.count : base.count,
      strategy:
        s.strategy === "quorum" || s.strategy === "firstSuccess" || s.strategy === "waitAll"
          ? s.strategy
          : base.strategy,
      profiles: [defaultChildProfile(s.childFsm)],
    };
  }

  const profiles = Array.isArray(s.profiles)
    ? (s.profiles as ChildProfile[]).map((p, i) => ({
        id: p.id || `p${i}`,
        childFsm: p.childFsm || "child-worker",
        toolPack: Array.isArray(p.toolPack) ? p.toolPack : [],
        skillPack: Array.isArray(p.skillPack) ? p.skillPack : [],
        credentialId: p.credentialId,
        modelId: p.modelId,
        inputMap: p.inputMap,
        timeoutMs: p.timeoutMs,
      }))
    : base.profiles;

  const maxConcurrency =
    typeof s.maxConcurrency === "number" ? Math.max(1, s.maxConcurrency) : base.maxConcurrency;

  return {
    mode: s.mode === "heterogeneous" ? "heterogeneous" : "homogeneous",
    count: typeof s.count === "number" ? s.count : base.count,
    maxConcurrency,
    strategy:
      s.strategy === "quorum" || s.strategy === "firstSuccess" || s.strategy === "waitAll"
        ? s.strategy
        : base.strategy,
    quorumK: typeof s.quorumK === "number" ? s.quorumK : undefined,
    cancelOnParentHalt:
      typeof s.cancelOnParentHalt === "boolean" ? s.cancelOnParentHalt : true,
    profiles: profiles.length > 0 ? profiles : base.profiles,
    aggregateTo: typeof s.aggregateTo === "string" ? s.aggregateTo : "",
  };
}

export function primaryProfile(spawn: SpawnConfig): ChildProfile {
  return spawn.profiles[0] ?? defaultChildProfile();
}

export function defaultNodeData(
  stateType: FSMStateType,
  label: string
): StateNodeData {
  const errorSignal =
    stateType === "AI"
      ? "::AI.VALIDATION_ERROR"
      : stateType === "SPAWN"
        ? "::SCRIPT.ERROR"
        : "::SCRIPT.ERROR";

  return {
    stateType,
    label,
    description: "",
    inputSchema: "",
    outputSchema: "",
    verify: { kind: "schema" },
    onError: { signal: errorSignal },
    script: {
      toolName: `${label.toLowerCase().replace(/\s+/g, "_")}_tool`,
      language: "python",
      code:
        stateType === "SCRIPT"
          ? 'def run(args, payload):\n    # deterministic work here\n    return {"signal": "::SCRIPT.NEXT"}\n'
          : "",
    },
    ai: {
      credentialId: "",
      model: "claude-sonnet-4-5",
      temperature: 0.2,
      maxTokens: 4000,
      systemPrompt: "",
      outputSchema: "",
    },
    guardrails: { timeoutMs: 30000, retryMax: 2, retryBackoffMs: 1000 },
    spawn: defaultSpawnConfig(),
    systemFunction: {
      summaryStrategy: "template",
      enabledStateIds: [],
      disabledStateIds: [],
      rewire: [],
    },
  };
}
