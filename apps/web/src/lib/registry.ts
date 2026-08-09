/** Project extension registry (FeatureShipping 001 C6) */

export interface CustomStateType {
  id: string;
  label: string;
  executorRef: string;
  defaultSignals: string[];
  inspectorSchema?: string;
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

export function emptyRegistry(): ProjectRegistry {
  return {
    customStates: [],
    customSignals: [],
    sysFuncTemplates: [],
    skills: [],
  };
}

const SIGNAL_RE = /^::[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/;

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

/** Built-in signals from SIGNAL_PRESETS + common error routes */
export const BUILTIN_SIGNALS = new Set([
  "::SCRIPT.NEXT",
  "::SCRIPT.ERROR",
  "::HTTP.NEXT",
  "::HTTP.ERROR",
  "::HTTP.OK",
  "::VALIDATE.NEXT",
  "::VALIDATE.ERROR",
  "::AI.NEXT",
  "::AI.GENERATE",
  "::AI.VALIDATION_ERROR",
  "::EXTERNAL_AI.NEXT",
  "::EXTERNAL_AI.ERROR",
  "::SPAWN.SUBAGENTS",
  "::SYSTEM.DEHYDRATE",
  "::SYSTEM.HYDRATE",
  "::SYSTEM.HALT",
  "::SYSTEM.CHECKPOINT",
]);

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
