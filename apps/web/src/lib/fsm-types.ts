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

export interface SpawnConfig {
  childFsm: string;
  count: number;
  strategy: "waitAll" | "quorum" | "firstSuccess";
}

export interface SystemFunctionConfig {
  summaryStrategy: "template" | "llm";
}

/** Data carried by every canvas node */
export interface StateNodeData extends Record<string, unknown> {
  stateType: FSMStateType;
  label: string;
  description: string;
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

export function defaultNodeData(
  stateType: FSMStateType,
  label: string
): StateNodeData {
  return {
    stateType,
    label,
    description: "",
    script: {
      toolName: `${label.toLowerCase().replace(/\s+/g, "_")}_tool`,
      language: "python",
      code:
        stateType === "SCRIPT"
          ? 'def run(args, payload):\n    # deterministic work here\n    return {"signal": "::SCRIPT.NEXT"}\n'
          : "",
    },
    ai: {
      model: "claude-sonnet-4-5",
      temperature: 0.2,
      maxTokens: 4000,
      systemPrompt: "",
      outputSchema: "",
    },
    guardrails: { timeoutMs: 30000, retryMax: 2, retryBackoffMs: 1000 },
    spawn: { childFsm: "child-worker", count: 3, strategy: "waitAll" },
    systemFunction: { summaryStrategy: "template" },
  };
}
