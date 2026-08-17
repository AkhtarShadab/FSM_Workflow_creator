import {
  isStateDisabledByMask,
  normalizeAggregate,
  normalizeEdgeData,
  normalizeGuardrails,
  normalizeSpawn,
  normalizeSystemFunction,
  normalizeToolAccess,
  primaryProfile,
  SYSFUNC_HEADS_WARN_THRESHOLD,
  type CanvasData,
  type LintIssue,
  type StateNode,
  type SystemFunctionConfig,
  type TransitionEdge,
} from "./fsm-types";
import {
  emptyRegistry,
  isKnownSignal,
  isKnownSkill,
  RESERVED_NAMESPACES,
  signalNamespace,
  type ProjectRegistry,
} from "./registry";

export interface LintCredentialRef {
  id: string;
  active: boolean;
  models: string[];
}

export interface LintContext {
  credentials?: LintCredentialRef[];
  registry?: ProjectRegistry;
}

/**
 * canvasToDsl — pure function (§10.2: "FSM DSL is derived via a pure
 * canvasToDsl() function (unit-testable, no DOM)").
 *
 * Converts React Flow canvas state into the versioned FSM Definition DSL
 * described in §5.2 of the design plan + FeatureShipping 001 C1 fields.
 */
export function canvasToDsl(
  canvas: CanvasData,
  meta: {
    name?: string;
    version?: number;
    registry?: ProjectRegistry;
  } = {}
) {
  const { nodes, edges } = canvas;

  const states = nodes.map((node) => {
    const transitions = edges
      .filter((e) => e.source === node.id)
      .map((e) => {
        const data = normalizeEdgeData(e.data, e.source, e.target);
        return {
          on: data.signal,
          to: e.target,
          kind: data.kind,
          ...(data.kind === "self-loop" && data.maxIterations != null
            ? { maxIterations: data.maxIterations }
            : {}),
          ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
          ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
        };
      });

    const verifiability = {
      ...(node.data.inputSchema ? { inputSchema: safeJson(node.data.inputSchema) } : {}),
      ...(node.data.outputSchema
        ? { outputSchema: safeJson(node.data.outputSchema) }
        : {}),
      verify: node.data.verify ?? { kind: "schema" },
      onError: node.data.onError ?? { signal: "::SCRIPT.ERROR" },
    };

    const guardrails = normalizeGuardrails(node.data.guardrails);
    const toolAccess = normalizeToolAccess(node.data.toolAccess);
    const retainContext = node.data.retainContext === true;

    const base = {
      id: node.id,
      type: node.data.stateType,
      label: node.data.label,
      ...(node.data.description ? { description: node.data.description } : {}),
      ...(node.data.customTypeId
        ? { customTypeId: node.data.customTypeId }
        : {}),
      ...(node.data.successCondition
        ? { successCondition: node.data.successCondition }
        : {}),
      ...(node.data.stateType === "END" && node.data.terminal
        ? { terminal: node.data.terminal }
        : {}),
      guardrails: {
        timeoutMs: guardrails.timeoutMs,
        retryMax: guardrails.retryMax,
        retryBackoffMs: guardrails.retryBackoffMs,
        retryOn: guardrails.retryOn,
      },
      toolAccess: {
        mode: toolAccess.mode,
        allow: toolAccess.allow,
      },
      retainContext,
      ...verifiability,
      transitions,
    };

    switch (node.data.stateType) {
      case "SCRIPT":
        return {
          ...base,
          tool: {
            name: node.data.script.toolName,
            language: node.data.script.language,
            timeoutMs: guardrails.timeoutMs,
            retry: {
              max: guardrails.retryMax,
              backoffMs: guardrails.retryBackoffMs,
              retryOn: guardrails.retryOn,
            },
          },
        };
      case "AI":
        return {
          ...base,
          llm: {
            ...(node.data.ai.credentialId
              ? { credentialId: node.data.ai.credentialId }
              : {}),
            model: node.data.ai.model,
            temperature: node.data.ai.temperature,
            maxTokens: node.data.ai.maxTokens,
            systemPrompt: node.data.ai.systemPrompt,
            ...(node.data.ai.outputSchema
              ? { outputSchema: safeJson(node.data.ai.outputSchema) }
              : {}),
          },
        };
      case "HTTP": {
        const http = node.data.http ?? {
          method: "GET" as const,
          urlTemplate: "",
          headers: {},
          successSignals: [] as string[],
        };
        return {
          ...base,
          http: {
            method: http.method,
            urlTemplate: http.urlTemplate,
            ...(http.authCredentialId
              ? { authCredentialId: http.authCredentialId }
              : {}),
            headers: http.headers ?? {},
            ...(http.bodyTemplate ? { bodyTemplate: http.bodyTemplate } : {}),
            successSignals: http.successSignals ?? [],
          },
        };
      }
      case "VALIDATE": {
        const v = node.data.validate ?? { kind: "schema" as const };
        return {
          ...base,
          validate: {
            kind: v.kind,
            ...(v.schema ? { schema: safeJson(v.schema) } : {}),
            ...(v.predicateRef ? { predicateRef: v.predicateRef } : {}),
          },
        };
      }
      case "EXTERNAL_AI": {
        const ea = node.data.externalAi ?? {
          credentialId: "",
          credentialKind: "openai_compatible" as const,
          baseUrl: "",
          model: "",
          temperature: 0.2,
          maxTokens: 4000,
          systemPrompt: "",
          outputSchema: "",
        };
        return {
          ...base,
          externalAi: {
            credentialId: ea.credentialId,
            credentialKind: ea.credentialKind,
            baseUrl: ea.baseUrl,
            model: ea.model,
            temperature: ea.temperature,
            maxTokens: ea.maxTokens,
            systemPrompt: ea.systemPrompt,
            ...(ea.outputSchema
              ? { outputSchema: safeJson(ea.outputSchema) }
              : {}),
          },
        };
      }
      case "SPAWN": {
        const spawn = normalizeSpawn(node.data.spawn);
        return {
          ...base,
          spawn: {
            mode: spawn.mode,
            count: spawn.count,
            maxConcurrency: Math.max(1, spawn.maxConcurrency),
            strategy: spawn.strategy,
            ...(spawn.strategy === "quorum" && spawn.quorumK != null
              ? { quorumK: spawn.quorumK }
              : {}),
            cancelOnParentHalt: spawn.cancelOnParentHalt,
            profiles: spawn.profiles,
            aggregateTo: spawn.aggregateTo,
            timeoutMs: guardrails.timeoutMs,
          },
        };
      }
      case "SYSTEM_FUNCTION": {
        const sf = normalizeSystemFunction(node.data.systemFunction);
        return {
          ...base,
          checkpoint: {
            summaryStrategy: sf.summaryStrategy,
            enabledStateIds: sf.enabledStateIds,
            disabledStateIds: sf.disabledStateIds,
            rewire: sf.rewire,
            heads: sf.heads,
          },
        };
      }
      case "AGGREGATE": {
        const aggregate = normalizeAggregate(node.data.aggregate);
        return {
          ...base,
          aggregate,
        };
      }
      case "HUMAN": {
        const human = node.data.human ?? {
          prompt: "",
          approvalSignals: ["::HUMAN.APPROVE"],
        };
        return {
          ...base,
          human: {
            prompt: human.prompt,
            approvalSignals: human.approvalSignals ?? [],
            ...(human.assignTo ? { assignTo: human.assignTo } : {}),
            ...(human.timeoutMs != null ? { timeoutMs: human.timeoutMs } : {}),
            ...(human.onTimeout ? { onTimeout: human.onTimeout } : {}),
          },
        };
      }
      case "START":
        return {
          ...base,
          hydration: { emitPhaseMap: true },
        };
      default:
        return base;
    }
  });

  return {
    version: meta.version ?? 1,
    name: meta.name ?? "untitled-harness",
    config: {
      toolLanguage: "python",
      checkpointStore: "redis",
      tokenBudget: { perRun: 200000, perState: 20000, onExceed: "halt" },
    },
    clusters: [],
    states,
    extensions: {
      registry: meta.registry ?? emptyRegistry(),
    },
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const ERROR_SIGNAL_HINT = /\.ERROR|VALIDATION_ERROR|HALT/;

/** `{{payload.foo}}` keys referenced in a template */
export function findUndeclaredPayloadKeys(template: string): string[] {
  const keys: string[] = [];
  const re = /\{\{\s*payload\.([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    keys.push(m[1]);
  }
  // Without a declared inputSchema we cannot resolve — flag all payload refs as undeclared
  return [...new Set(keys)];
}

function issue(
  severity: LintIssue["severity"],
  code: string,
  message: string,
  nodeId?: string
): LintIssue {
  return { severity, code, message, nodeId };
}

/** Whether a SYSTEM_FUNCTION mask has any enable/disable/rewire entries */
export function maskIsActive(mask: SystemFunctionConfig): boolean {
  return (
    mask.enabledStateIds.length > 0 ||
    mask.disabledStateIds.length > 0 ||
    mask.rewire.length > 0
  );
}

/**
 * BFS reachability START → END under a SYS_FUNC mask.
 * Disabled nodes are skipped (outgoing edges of disabled nodes are not taken
 * from them as sources; edges into them do not land). Rewire rows override
 * (from, on) → to when both endpoints are enabled.
 */
export function hasPathToEndUnderMask(
  nodes: StateNode[],
  edges: TransitionEdge[],
  mask: SystemFunctionConfig
): boolean {
  const starts = nodes.filter((n) => n.data.stateType === "START");
  const ends = new Set(
    nodes.filter((n) => n.data.stateType === "END").map((n) => n.id)
  );
  if (starts.length === 0 || ends.size === 0) return false;

  const enabled = new Set(
    nodes
      .filter((n) => !isStateDisabledByMask(n.id, mask))
      .map((n) => n.id)
  );

  // Adjacency: signal-keyed map, then apply rewires
  type Adj = Map<string, Map<string, string>>; // from → (on → to)
  const adj: Adj = new Map();

  const setEdge = (from: string, on: string, to: string) => {
    if (!enabled.has(from) || !enabled.has(to)) return;
    if (!adj.has(from)) adj.set(from, new Map());
    adj.get(from)!.set(on, to);
  };

  for (const e of edges) {
    // Router edges are SYS_FUNC wiring, not flow — mirror the C7
    // UNREACHABLE / DEAD_END reachability checks and skip them.
    const data = normalizeEdgeData(e.data, e.source, e.target);
    if (data.kind === "router") continue;
    setEdge(e.source, data.signal, e.target);
  }
  for (const r of mask.rewire) {
    if (r.from && r.on && r.to) setEdge(r.from, r.on, r.to);
  }

  const queue = starts.map((s) => s.id).filter((id) => enabled.has(id));
  const seen = new Set<string>(queue);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (ends.has(cur)) return true;
    const outs = adj.get(cur);
    if (!outs) continue;
    for (const to of outs.values()) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return false;
}

/** Lint helpers (E4 — FSM linter + FeatureShipping 001 C1–C6) */
export function lintCanvas(
  canvas: CanvasData,
  ctx: LintContext = {}
): LintIssue[] {
  const issues: LintIssue[] = [];
  const { nodes, edges } = canvas;
  const nodeIds = new Set(nodes.map((n) => n.id));
  const registry = ctx.registry ?? emptyRegistry();
  const credentials = ctx.credentials ?? [];
  const credById = new Map(credentials.map((c) => [c.id, c]));

  const starts = nodes.filter((n) => n.data.stateType === "START");
  if (starts.length === 0) {
    issues.push(issue("warning", "MISSING_START", "Missing START state."));
  }
  if (starts.length > 1) {
    issues.push(
      issue("warning", "MULTIPLE_START", "Multiple START states defined.")
    );
  }

  const ends = nodes.filter((n) => n.data.stateType === "END");
  if (ends.length === 0) {
    issues.push(issue("warning", "MISSING_END", "Missing END state."));
  }

  const flowEdges = edges.filter((e) => {
    const kind = normalizeEdgeData(e.data, e.source, e.target).kind;
    return kind !== "router";
  });

  const targetIds = new Set(flowEdges.map((e) => e.target));
  for (const n of nodes) {
    if (n.data.stateType !== "START" && !targetIds.has(n.id)) {
      issues.push(
        issue(
          "warning",
          "UNREACHABLE",
          `State "${n.data.label}" (${n.id}) is unreachable.`,
          n.id
        )
      );
    }
  }

  const sourceIds = new Set(flowEdges.map((e) => e.source));
  for (const n of nodes) {
    if (n.data.stateType !== "END" && !sourceIds.has(n.id)) {
      issues.push(
        issue(
          "warning",
          "DEAD_END",
          `State "${n.data.label}" (${n.id}) is a dead end.`,
          n.id
        )
      );
    }
  }

  const runnable = nodes.filter((n) =>
    ["SCRIPT", "AI", "SPAWN", "HTTP", "VALIDATE", "EXTERNAL_AI", "HUMAN"].includes(
      n.data.stateType
    )
  );
  for (const n of runnable) {
    const outs = flowEdges.filter((e) => e.source === n.id);
    const hasErrorEdge = outs.some((e) =>
      ERROR_SIGNAL_HINT.test(e.data?.signal ?? "")
    );
    if (!hasErrorEdge) {
      issues.push(
        issue(
          "warning",
          "MISSING_ERROR_EDGE",
          `State "${n.data.label}" (${n.id}) has no error-routing edge (::*.ERROR / VALIDATION_ERROR).`,
          n.id
        )
      );
    }
  }

  for (const e of edges) {
    const data = normalizeEdgeData(e.data, e.source, e.target);
    if (data.kind === "self-loop") {
      if (e.source !== e.target) {
        issues.push(
          issue(
            "error",
            "SELF_LOOP_INVALID_TARGET",
            `Edge ${e.id}: self-loop kind requires source === target.`,
            e.source
          )
        );
      }
      if (data.maxIterations == null || data.maxIterations < 1) {
        issues.push(
          issue(
            "error",
            "SELF_LOOP_MISSING_MAX_ITER",
            `Edge ${e.id}: self-loop requires maxIterations ≥ 1.`,
            e.source
          )
        );
      } else if (data.maxIterations > 100) {
        issues.push(
          issue(
            "warning",
            "SELF_LOOP_HIGH_MAX_ITER",
            `Edge ${e.id}: maxIterations=${data.maxIterations} is very large.`,
            e.source
          )
        );
      }
    }
  }

  for (const n of nodes.filter((x) => x.data.stateType === "SPAWN")) {
    const spawn = normalizeSpawn(n.data.spawn);
    const profile = primaryProfile(spawn);

    if (spawn.maxConcurrency < 1) {
      issues.push(
        issue(
          "error",
          "SPAWN_CONCURRENCY",
          `SPAWN "${n.data.label}": maxConcurrency must be ≥ 1.`,
          n.id
        )
      );
    }

    if (spawn.mode === "heterogeneous" && spawn.profiles.length !== spawn.count) {
      issues.push(
        issue(
          "error",
          "SPAWN_PROFILE_MISMATCH",
          `SPAWN "${n.data.label}": heterogeneous mode requires profiles.length === count (${spawn.profiles.length} ≠ ${spawn.count}).`,
          n.id
        )
      );
    }

    if (profile.toolPack.length === 0) {
      issues.push(
        issue(
          "warning",
          "SPAWN_EMPTY_TOOL_PACK",
          `SPAWN "${n.data.label}": empty tool pack — AI-only children OK; SCRIPT children will have no tools.`,
          n.id
        )
      );
    }

    for (const skill of profile.skillPack) {
      if (!skill.trim()) {
        issues.push(
          issue(
            "error",
            "SPAWN_EMPTY_SKILL_REF",
            `SPAWN "${n.data.label}": empty skill ref in skill pack.`,
            n.id
          )
        );
      } else if (!isKnownSkill(skill, registry)) {
        issues.push(
          issue(
            "error",
            "SPAWN_UNKNOWN_SKILL",
            `SPAWN "${n.data.label}": skill "${skill}" is not in the project registry.`,
            n.id
          )
        );
      }
    }

    if (spawn.aggregateTo) {
      const target = nodes.find((x) => x.id === spawn.aggregateTo);
      if (!target) {
        issues.push(
          issue(
            "error",
            "SPAWN_AGGREGATE_TARGET_INVALID",
            `SPAWN "${n.data.label}": aggregateTo "${spawn.aggregateTo}" does not exist.`,
            n.id
          )
        );
      } else if (target.data.stateType !== "AGGREGATE") {
        issues.push(
          issue(
            "error",
            "SPAWN_AGGREGATE_TARGET_INVALID",
            `SPAWN "${n.data.label}": aggregateTo must target an AGGREGATE state (got ${target.data.stateType}).`,
            n.id
          )
        );
      }
    }
  }

  // SPAWN ↔ AGGREGATE 1:1 pairing (§10.3)
  const spawnByAggregate = new Map<string, string[]>();
  for (const n of nodes.filter((x) => x.data.stateType === "SPAWN")) {
    const to = normalizeSpawn(n.data.spawn).aggregateTo;
    if (!to) continue;
    const list = spawnByAggregate.get(to) ?? [];
    list.push(n.id);
    spawnByAggregate.set(to, list);
  }
  for (const [aggId, spawnIds] of spawnByAggregate) {
    if (spawnIds.length > 1) {
      issues.push(
        issue(
          "error",
          "AGGREGATE_MULTIPLE_SPAWN",
          `AGGREGATE "${aggId}" is claimed by multiple SPAWN nodes (${spawnIds.join(", ")}).`,
          aggId
        )
      );
    }
  }
  for (const n of nodes.filter((x) => x.data.stateType === "AGGREGATE")) {
    const aggregate = normalizeAggregate(n.data.aggregate);
    const claimants = spawnByAggregate.get(n.id) ?? [];
    if (aggregate.fromSpawnId) {
      const spawnNode = nodes.find((x) => x.id === aggregate.fromSpawnId);
      if (!spawnNode || spawnNode.data.stateType !== "SPAWN") {
        issues.push(
          issue(
            "error",
            "AGGREGATE_SPAWN_MISMATCH",
            `AGGREGATE "${n.data.label}": fromSpawnId "${aggregate.fromSpawnId}" is not a SPAWN node.`,
            n.id
          )
        );
      } else {
        const spawn = normalizeSpawn(spawnNode.data.spawn);
        if (spawn.aggregateTo !== n.id) {
          issues.push(
            issue(
              "error",
              "AGGREGATE_SPAWN_MISMATCH",
              `AGGREGATE "${n.data.label}": fromSpawnId does not point back via SPAWN.aggregateTo.`,
              n.id
            )
          );
        }
        if (
          spawn.strategy !== aggregate.strategy &&
          claimants.includes(aggregate.fromSpawnId)
        ) {
          issues.push(
            issue(
              "warning",
              "AGGREGATE_STRATEGY_MISMATCH",
              `AGGREGATE "${n.data.label}": strategy differs from paired SPAWN.`,
              n.id
            )
          );
        }
      }
    } else if (claimants.length === 1) {
      // soft: back-ref missing but forward ref exists
      issues.push(
        issue(
          "warning",
          "AGGREGATE_SPAWN_MISMATCH",
          `AGGREGATE "${n.data.label}": set fromSpawnId to "${claimants[0]}" to complete the 1:1 pairing.`,
          n.id
        )
      );
    }
  }

  // C6 — unknown / reserved edge signals
  for (const e of edges) {
    const signal = e.data?.signal ?? "::SCRIPT.NEXT";
    const ns = signalNamespace(signal);
    if (RESERVED_NAMESPACES.has(ns) && !isKnownSignal(signal, registry)) {
      issues.push(
        issue(
          "error",
          "SIGNAL_RESERVED",
          `Edge ${e.id}: signal "${signal}" uses reserved namespace ${ns}.`,
          e.source
        )
      );
    } else if (!isKnownSignal(signal, registry)) {
      issues.push(
        issue(
          "error",
          "UNKNOWN_SIGNAL",
          `Edge ${e.id}: unknown signal "${signal}" (not built-in or registered).`,
          e.source
        )
      );
    }
  }

  // START legacy default edge warning
  for (const e of edges) {
    const source = nodes.find((n) => n.id === e.source);
    if (source?.data.stateType === "START") {
      const signal = e.data?.signal ?? "::SCRIPT.NEXT";
      if (signal === "::SCRIPT.NEXT") {
        issues.push(
          issue(
            "warning",
            "START_LEGACY_SIGNAL",
            `Edge ${e.id}: START still uses legacy ::SCRIPT.NEXT (prefer ::STATE.SUCCESS).`,
            e.source
          )
        );
      }
    }
  }

  // C3 — AI credential / model refs
  for (const n of nodes.filter((x) => x.data.stateType === "AI")) {
    const credId = n.data.ai.credentialId;
    if (credId) {
      const cred = credById.get(credId);
      if (!cred) {
        issues.push(
          issue(
            "error",
            "AI_CREDENTIAL_MISSING",
            `AI "${n.data.label}": credential "${credId}" not found.`,
            n.id
          )
        );
      } else if (!cred.active) {
        issues.push(
          issue(
            "error",
            "AI_CREDENTIAL_INACTIVE",
            `AI "${n.data.label}": credential "${credId}" is inactive.`,
            n.id
          )
        );
      } else if (
        n.data.ai.model &&
        cred.models.length > 0 &&
        !cred.models.includes(n.data.ai.model)
      ) {
        issues.push(
          issue(
            "warning",
            "AI_MODEL_UNKNOWN",
            `AI "${n.data.label}": model "${n.data.ai.model}" not in discovered list for this credential.`,
            n.id
          )
        );
      }
    }
  }

  for (const n of nodes.filter((x) => x.data.stateType === "HTTP")) {
    const http = n.data.http ?? {
      method: "GET" as const,
      urlTemplate: "",
      headers: {},
      successSignals: [] as string[],
    };
    if (!http.successSignals || http.successSignals.length === 0) {
      issues.push(
        issue(
          "error",
          "HTTP_NO_SUCCESS_SIGNALS",
          `HTTP "${n.data.label}": successSignals must not be empty.`,
          n.id
        )
      );
    }
    const undeclared = findUndeclaredPayloadKeys(http.urlTemplate ?? "");
    if (undeclared.length > 0) {
      issues.push(
        issue(
          "warning",
          "HTTP_UNDECLARED_PAYLOAD_KEY",
          `HTTP "${n.data.label}": urlTemplate references undeclared payload key(s): ${undeclared.join(", ")}.`,
          n.id
        )
      );
    }
  }

  for (const n of nodes.filter((x) => x.data.stateType === "VALIDATE")) {
    const v = n.data.validate ?? { kind: "schema" as const };
    const missingSchema =
      v.kind === "schema" && !(v.schema && v.schema.trim());
    const missingPred =
      v.kind === "predicate" && !(v.predicateRef && v.predicateRef.trim());
    if (missingSchema || missingPred) {
      issues.push(
        issue(
          "error",
          "VALIDATE_INCOMPLETE",
          `VALIDATE "${n.data.label}": ${
            v.kind === "schema"
              ? "schema is required"
              : "predicateRef is required"
          }.`,
          n.id
        )
      );
    }

    const verify = n.data.verify;
    if (!verify || !verify.kind) {
      issues.push(
        issue(
          "error",
          "VALIDATE_MISSING_VERIFY",
          `VALIDATE "${n.data.label}": verify is required (executor-less gate).`,
          n.id
        )
      );
    } else if (
      verify.kind === "script" &&
      !(verify.scriptRef && verify.scriptRef.trim())
    ) {
      issues.push(
        issue(
          "error",
          "VALIDATE_MISSING_VERIFY",
          `VALIDATE "${n.data.label}": verify.scriptRef is required when kind is script.`,
          n.id
        )
      );
    }

    const hasExecutorBody =
      Boolean(n.data.script?.code?.trim()) ||
      Boolean(n.data.ai?.systemPrompt?.trim()) ||
      Boolean(n.data.externalAi?.systemPrompt?.trim()) ||
      Boolean(n.data.http?.bodyTemplate?.trim());
    if (hasExecutorBody) {
      issues.push(
        issue(
          "error",
          "VALIDATE_HAS_EXECUTOR",
          `VALIDATE "${n.data.label}": must not define script/ai/http/externalAi executor bodies.`,
          n.id
        )
      );
    }
  }

  for (const n of nodes.filter((x) => x.data.stateType === "HUMAN")) {
    const human = n.data.human;
    if (!human?.prompt?.trim()) {
      issues.push(
        issue(
          "warning",
          "HUMAN_EMPTY_PROMPT",
          `HUMAN "${n.data.label}": prompt is empty.`,
          n.id
        )
      );
    }
    if (!human?.approvalSignals?.length) {
      issues.push(
        issue(
          "error",
          "HUMAN_NO_APPROVAL_SIGNALS",
          `HUMAN "${n.data.label}": approvalSignals must not be empty.`,
          n.id
        )
      );
    }
  }

  // C2 — SYS_FUNC enable map / rewire lint + C7 router heads
  for (const n of nodes.filter((x) => x.data.stateType === "SYSTEM_FUNCTION")) {
    const mask = normalizeSystemFunction(n.data.systemFunction);
    const label = n.data.label;

    if (mask.heads.length < 2) {
      issues.push(
        issue(
          "warning",
          "SYSFUNC_FEW_HEADS",
          `SYS_FUNC "${label}": router should have ≥ 2 heads (has ${mask.heads.length}).`,
          n.id
        )
      );
    }
    if (mask.heads.length > SYSFUNC_HEADS_WARN_THRESHOLD) {
      issues.push(
        issue(
          "warning",
          "SYSFUNC_MANY_HEADS",
          `SYS_FUNC "${label}": ${mask.heads.length} heads may hurt canvas legibility.`,
          n.id
        )
      );
    }
    for (const head of mask.heads) {
      if (head.componentRef && !nodeIds.has(head.componentRef)) {
        // Allow external refs that look non-state (no S… pattern) — only error if it looks like a state id that is missing
        // Per §10.2: componentRef may be stateId OR external. Error only when ref matches no node AND isn't empty.
        // External refs (credentials/services) are allowed when they don't collide with missing node expectation —
        // treat unresolved as error only when the ref equals a deleted-looking canvas id OR when it's intended as state.
        // Spec: "error if a head's componentRef doesn't resolve" — resolve = node id OR external string with ":" / "ext:"
        const looksExternal =
          head.componentRef.includes(":") ||
          head.componentRef.startsWith("ext-") ||
          head.componentRef.startsWith("cred-");
        if (!looksExternal) {
          issues.push(
            issue(
              "error",
              "SYSFUNC_HEAD_UNRESOLVED",
              `SYS_FUNC "${label}": head "${head.label}" componentRef "${head.componentRef}" does not resolve.`,
              n.id
            )
          );
        }
      }
    }

    for (const r of mask.rewire) {
      if (r.to && !nodeIds.has(r.to)) {
        issues.push(
          issue(
            "error",
            "REWIRE_TARGET_MISSING",
            `SYS_FUNC "${label}": rewire target "${r.to}" does not exist.`,
            n.id
          )
        );
      }
      if (r.from && r.on) {
        const match = edges.some(
          (e) =>
            e.source === r.from && (e.data?.signal ?? "::SCRIPT.NEXT") === r.on
        );
        if (!match) {
          issues.push(
            issue(
              "warning",
              "REWIRE_NO_MATCHING_EDGE",
              `SYS_FUNC "${label}": rewire ${r.from} on ${r.on} has no matching authored edge.`,
              n.id
            )
          );
        }
      }
    }

    if (maskIsActive(mask) && !hasPathToEndUnderMask(nodes, edges, mask)) {
      issues.push(
        issue(
          "error",
          "MASK_NO_PATH_TO_END",
          `SYS_FUNC "${label}": enable map leaves no path from START to END.`,
          n.id
        )
      );
    }

    // Mask drops all error-routing edges of a still-enabled runnable state
    for (const r of runnable) {
      if (isStateDisabledByMask(r.id, mask)) continue;
      const errorEdges = flowEdges.filter(
        (e) =>
          e.source === r.id && ERROR_SIGNAL_HINT.test(e.data?.signal ?? "")
      );
      if (errorEdges.length === 0) continue;
      const allTargetsDisabled = errorEdges.every((e) =>
        isStateDisabledByMask(e.target, mask)
      );
      if (allTargetsDisabled) {
        issues.push(
          issue(
            "warning",
            "MASK_DROPS_ERROR_EDGES",
            `SYS_FUNC "${label}": mask disables all error targets of "${r.data.label}".`,
            n.id
          )
        );
      }
    }
  }

  for (const n of nodes) {
    const guardrails = normalizeGuardrails(n.data.guardrails);
    const ignoredRetryTypes = new Set([
      "HUMAN",
      "START",
      "END",
      "SYSTEM_FUNCTION",
      "SPAWN",
      "AGGREGATE",
    ]);
    if (ignoredRetryTypes.has(n.data.stateType) && guardrails.retryMax > 0) {
      issues.push(
        issue(
          "warning",
          "RETRY_IGNORED_ON_TYPE",
          `${n.data.stateType} "${n.data.label}": retryMax is ignored on this state type (use self-loop or HUMAN onTimeout instead).`,
          n.id
        )
      );
    }

    if (n.data.stateType === "AI" && n.data.retainContext === true) {
      issues.push(
        issue(
          "warning",
          "RETAIN_CONTEXT_COST",
          `AI "${n.data.label}": retainContext keeps full chat history — increases token cost for downstream states.`,
          n.id
        )
      );
    }

    const sc = n.data.successCondition;
    if (sc?.kind === "llm_verify" && !sc.credentialId?.trim()) {
      issues.push(
        issue(
          "error",
          "VERIFY_MISSING_CREDENTIAL",
          `${n.data.stateType} "${n.data.label}": llm_verify success condition requires a judge credential.`,
          n.id
        )
      );
    }
    if (sc?.kind === "predicate" && !sc.expr?.trim()) {
      issues.push(
        issue(
          "warning",
          "PREDICATE_EMPTY",
          `${n.data.stateType} "${n.data.label}": predicate success condition has an empty expr.`,
          n.id
        )
      );
    }
  }

  return issues;
}
