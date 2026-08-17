/** Project extension registry (FeatureShipping 001 C6 + 013 F1) */

import {
  STATE_SIGNAL_KITS,
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
  if (registry.customSignals.some((s) => s.signal === signal)) {
    return registry;
  }
  return {
    ...registry,
    customSignals: [...registry.customSignals, { signal, description }],
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

export function removeSignal(
  registry: ProjectRegistry,
  signal: string
): ProjectRegistry {
  return {
    ...registry,
    customSignals: registry.customSignals.filter((s) => s.signal !== signal),
  };
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
