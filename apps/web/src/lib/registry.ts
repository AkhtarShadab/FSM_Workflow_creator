/** Project extension registry (FeatureShipping 001 C6 + 013 F1/F2) */

import {
  STATE_SIGNAL_KITS,
  SIGNAL_PRESETS,
  type CanvasData,
  type EdgeKind,
  type FSMStateType,
  type PaletteGroupId,
  type SuccessCondition,
} from "./fsm-types";

export interface CustomStateType {
  id: string;
  label: string;
  group: PaletteGroupId;
  executorKind: "script" | "http" | "ai" | "none";
  defaultSignals: string[];
  successCondition?: SuccessCondition;
  inspectorSchema?: string;
  description: string;
}

export interface CustomSignal {
  /** namespaced ::NAMESPACE.EVENT */
  signal: string;
  description?: string;
}

export interface CustomSysFuncTemplate {
  id: string;
  label: string;
  summaryStrategy: "template" | "llm";
  enabledStateIds: string[];
  disabledStateIds: string[];
  rewire: Array<{ from: string; on: string; to: string }>;
}

export interface ProjectRegistry {
  customStates: CustomStateType[];
  customSignals: CustomSignal[];
  sysFuncTemplates: CustomSysFuncTemplate[];
  /** Opaque skill ids available to SPAWN skill packs */
  skills: string[];
}

export const RESERVED_NAMESPACES = new Set([
  "SCRIPT",
  "HTTP",
  "VALIDATE",
  "AI",
  "EXTERNAL_AI",
  "HUMAN",
  "SPAWN",
  "SYSTEM",
  "STATE",
  "TRANSITION",
]);

const BUILTIN_STATE_TYPES = new Set<FSMStateType>([
  "START",
  "SCRIPT",
  "HTTP",
  "AI",
  "EXTERNAL_AI",
  "VALIDATE",
  "HUMAN",
  "SPAWN",
  "AGGREGATE",
  "SYSTEM_FUNCTION",
  "END",
]);

function collectKitSignals(): string[] {
  const signals: string[] = [];
  for (const kit of Object.values(STATE_SIGNAL_KITS)) {
    signals.push(kit.success, kit.failure);
    if (kit.extras) signals.push(...kit.extras);
  }
  return signals;
}

/** Built-in signals from signal kits + lifecycle / transition namespaces */
export const BUILTIN_SIGNALS = new Set([
  ...collectKitSignals(),
  "::HTTP.OK",
  "::SYSTEM.CHECKPOINT",
  "::STATE.ENTER",
  "::STATE.RETRY",
  "::TRANSITION.TAKEN",
  "::TRANSITION.BLOCKED",
  "::TRANSITION.VERIFY_FAIL",
]);

export function emptyRegistry(): ProjectRegistry {
  return {
    customStates: [],
    customSignals: [],
    sysFuncTemplates: [],
    skills: [],
  };
}

const SIGNAL_RE = /^::[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/;

export function signalNamespace(signal: string): string {
  return signal.slice(2).split(".")[0] ?? "";
}

export function isValidSignalNamespace(signal: string): boolean {
  return SIGNAL_RE.test(signal);
}

const MIN_SIGNAL_DESCRIPTION = 8;

export function registerSignal(
  registry: ProjectRegistry,
  signal: string,
  description?: string
): ProjectRegistry {
  if (!isValidSignalNamespace(signal)) {
    throw new Error(`Invalid signal namespace: ${signal}`);
  }
  const ns = signalNamespace(signal);
  if (RESERVED_NAMESPACES.has(ns)) {
    throw new Error(`SIGNAL_RESERVED: namespace ${ns} is reserved`);
  }
  if (BUILTIN_SIGNALS.has(signal)) {
    throw new Error(`SIGNAL_BUILTIN: ${signal} is a built-in signal`);
  }
  const desc = description?.trim() ?? "";
  if (desc.length < MIN_SIGNAL_DESCRIPTION) {
    throw new Error(
      `Description is required (min ${MIN_SIGNAL_DESCRIPTION} chars)`
    );
  }
  if (registry.customSignals.some((s) => s.signal === signal)) {
    return registry;
  }
  return {
    ...registry,
    customSignals: [...registry.customSignals, { signal, description: desc }],
  };
}

export function registerSkill(
  registry: ProjectRegistry,
  skillId: string
): ProjectRegistry {
  const id = skillId.trim();
  if (!id) throw new Error("Empty skill id");
  if (registry.skills.includes(id)) return registry;
  return { ...registry, skills: [...registry.skills, id] };
}

export function registerCustomState(
  registry: ProjectRegistry,
  state: CustomStateType
): ProjectRegistry {
  if (!state.id.trim()) throw new Error("Empty state id");
  if (BUILTIN_STATE_TYPES.has(state.id as FSMStateType)) {
    throw new Error(
      `CUSTOM_TYPE_COLLIDES_BUILTIN: id "${state.id}" collides with a built-in state type`
    );
  }
  if (registry.customStates.some((s) => s.id === state.id)) {
    throw new Error(`Duplicate custom state: ${state.id}`);
  }
  return {
    ...registry,
    customStates: [...registry.customStates, state],
  };
}

/** True when any canvas edge or HTTP successSignals references the signal. */
export function signalInUse(canvas: CanvasData, signal: string): boolean {
  for (const e of canvas.edges) {
    if (e.data?.signal === signal) return true;
  }
  for (const n of canvas.nodes) {
    const successSignals = n.data.http?.successSignals ?? [];
    if (successSignals.includes(signal)) return true;
  }
  return false;
}

export function removeSignal(
  registry: ProjectRegistry,
  signal: string,
  canvas?: CanvasData
): ProjectRegistry {
  if (canvas && signalInUse(canvas, signal)) {
    throw new Error(`SIGNAL_IN_USE: ${signal} is referenced on the canvas`);
  }
  return {
    ...registry,
    customSignals: registry.customSignals.filter((s) => s.signal !== signal),
  };
}

export function removeCustomState(
  registry: ProjectRegistry,
  stateId: string
): ProjectRegistry {
  return {
    ...registry,
    customStates: registry.customStates.filter((s) => s.id !== stateId),
  };
}

export interface GroupedSignalPreset {
  namespace: string;
  items: { signal: string; kind: EdgeKind; hint: string }[];
}

/** Built-in + registry presets grouped by namespace for edge inspector (013 F2). */
export function groupedSignalPresets(
  registry: ProjectRegistry
): GroupedSignalPreset[] {
  const byNs = new Map<string, GroupedSignalPreset["items"]>();

  const add = (signal: string, kind: EdgeKind, hint: string) => {
    const ns = signalNamespace(signal);
    const list = byNs.get(ns) ?? [];
    if (!list.some((i) => i.signal === signal)) {
      list.push({ signal, kind, hint });
      byNs.set(ns, list);
    }
  };

  for (const preset of SIGNAL_PRESETS) {
    add(preset.signal, preset.kind, preset.hint);
  }
  for (const custom of registry.customSignals) {
    add(
      custom.signal,
      "script",
      custom.description?.trim() || "project-registered signal"
    );
  }

  const order = [
    "SCRIPT",
    "HTTP",
    "VALIDATE",
    "AI",
    "EXTERNAL_AI",
    "HUMAN",
    "SPAWN",
    "STATE",
    "TRANSITION",
    "SYSTEM",
  ];
  const sorted = [...byNs.entries()].sort(([a], [b]) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return sorted.map(([namespace, items]) => ({ namespace, items }));
}

export function executorKindToStateType(
  kind: CustomStateType["executorKind"]
): FSMStateType {
  switch (kind) {
    case "script":
      return "SCRIPT";
    case "http":
      return "HTTP";
    case "ai":
      return "AI";
    case "none":
      return "VALIDATE";
  }
}

export function removeSkill(
  registry: ProjectRegistry,
  skillId: string
): ProjectRegistry {
  return {
    ...registry,
    skills: registry.skills.filter((s) => s !== skillId),
  };
}

export function isKnownSignal(
  signal: string,
  registry: ProjectRegistry
): boolean {
  if (BUILTIN_SIGNALS.has(signal)) return true;
  return registry.customSignals.some((s) => s.signal === signal);
}

export function isKnownSkill(
  skillId: string,
  registry: ProjectRegistry
): boolean {
  return registry.skills.includes(skillId);
}

export function exportRegistryBundle(registry: ProjectRegistry): string {
  return JSON.stringify({ version: 1, registry }, null, 2);
}
