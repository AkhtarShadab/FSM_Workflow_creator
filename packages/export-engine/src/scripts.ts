import { ExportEngineError } from "./errors";
import type { ExportOptions, FsmDsl } from "./types";

export interface ScriptTool {
  stateId: string;
  toolName: string;
  source: string;
  path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isScriptState(state: unknown): state is Record<string, unknown> {
  if (!isRecord(state)) return false;
  const kind = state.type ?? state.stateType;
  return kind === "SCRIPT";
}

function firstString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string") return c;
  }
  return undefined;
}

export function scriptSource(state: Record<string, unknown>): string {
  const script = isRecord(state.script) ? state.script : undefined;
  const tool = isRecord(state.tool) ? state.tool : undefined;
  return (
    firstString(script?.code, tool?.code, tool?.source, state.code) ?? ""
  );
}

export function scriptToolName(state: Record<string, unknown>, fallback: string): string {
  const script = isRecord(state.script) ? state.script : undefined;
  const tool = isRecord(state.tool) ? state.tool : undefined;
  const raw =
    firstString(script?.toolName, tool?.name, state.toolName, state.id, fallback) ??
    fallback;
  return sanitizeFileStem(raw);
}

export function sanitizeFileStem(raw: string): string {
  const trimmed = raw.trim() || "tool";
  const safe = trimmed.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  return safe || "tool";
}

export function toolExtension(toolLanguage: ExportOptions["toolLanguage"]): string {
  return toolLanguage === "bash" ? ".sh" : ".py";
}

export function collectScriptTools(
  dsl: FsmDsl,
  toolLanguage: ExportOptions["toolLanguage"]
): ScriptTool[] {
  const states = Array.isArray(dsl.states) ? dsl.states : [];
  const ext = toolExtension(toolLanguage);
  const used = new Set<string>();
  const tools: ScriptTool[] = [];

  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    if (!isScriptState(state)) continue;

    const source = scriptSource(state);
    if (source.trim() === "") {
      const id =
        (typeof state.id === "string" && state.id) ||
        (typeof state.label === "string" && state.label) ||
        `index-${i}`;
      throw new ExportEngineError(
        "TOOL_SOURCE_MISSING",
        `SCRIPT state "${id}" has empty tool source`
      );
    }

    const stateId =
      (typeof state.id === "string" && state.id) || `script-${i}`;
    const toolName = scriptToolName(state, stateId);
    let path = `tools/${toolName}${ext}`;
    if (used.has(path)) {
      path = `tools/${toolName}-${sanitizeFileStem(stateId)}${ext}`;
    }
    used.add(path);
    tools.push({ stateId, toolName, source, path });
  }

  return tools;
}
