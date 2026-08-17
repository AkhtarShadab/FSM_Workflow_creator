/**
 * R2 — Success condition evaluator (FeatureShipping 014).
 * Pure module: no supervisor dependency.
 */

export type SuccessCondition =
  | { kind: "signal" }
  | { kind: "schema"; schema: string }
  | { kind: "predicate"; expr: string }
  | {
      kind: "llm_verify";
      credentialId: string;
      modelId: string;
      rubric: string;
      onFail: "retry" | "error_signal";
    };

export interface SuccessVerifyInput {
  signal: string;
  payload: unknown;
  stateId: string;
  /** State success-kit signal; required when condition.kind === "signal". */
  successSignal?: string;
  /** Authored outgoing edge signals (union with success kit for signal kind). */
  outgoingSignals?: string[];
}

export interface SuccessVerifyResult {
  pass: boolean;
  reason?: string;
}

export interface LlmJudgeRequest {
  rubric: string;
  payload: unknown;
  credentialId: string;
  modelId: string;
}

export interface LlmJudgeResult {
  pass: boolean;
  reason: string;
}

export interface EvaluateSuccessOptions {
  judge?: (req: LlmJudgeRequest) => Promise<LlmJudgeResult>;
  isMockProvider?: () => boolean;
}

const FAIL_CLOSED: SuccessVerifyResult = { pass: false, reason: "verify_fail" };

export function isMockProviderEnabled(): boolean {
  return process.env.FSM_MOCK_PROVIDER === "1";
}

function payloadAsString(payload: unknown): string {
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function validateWithMinimalSchema(
  data: unknown,
  schemaJson: string
): { ok: boolean; reason?: string } {
  try {
    const schema = JSON.parse(schemaJson) as Record<string, unknown>;
    if (schema.type === "object" && typeof data === "object" && data !== null) {
      const obj = data as Record<string, unknown>;
      const required = (schema.required as string[] | undefined) ?? [];
      for (const key of required) {
        if (!(key in obj)) {
          return { ok: false, reason: `missing required property: ${key}` };
        }
      }
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      if (properties) {
        for (const [key, propSchema] of Object.entries(properties)) {
          if (key in obj && propSchema.type) {
            const actual = obj[key];
            const expected = propSchema.type as string;
            if (expected === "string" && typeof actual !== "string") {
              return { ok: false, reason: `${key} must be string` };
            }
            if (expected === "number" && typeof actual !== "number") {
              return { ok: false, reason: `${key} must be number` };
            }
            if (expected === "boolean" && typeof actual !== "boolean") {
              return { ok: false, reason: `${key} must be boolean` };
            }
            if (expected === "object" && (typeof actual !== "object" || actual === null)) {
              return { ok: false, reason: `${key} must be object` };
            }
          }
        }
      }
      return { ok: true };
    }
    if (schema.type === "string" && typeof data !== "string") {
      return { ok: false, reason: "expected string" };
    }
    if (schema.type === "number" && typeof data !== "number") {
      return { ok: false, reason: "expected number" };
    }
    if (schema.type === "boolean" && typeof data !== "boolean") {
      return { ok: false, reason: "expected boolean" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "invalid schema" };
  }
}

function resolveVarPath(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = data;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function evalJsonLogicValue(expr: unknown, data: Record<string, unknown>): unknown {
  if (expr === null || typeof expr !== "object") return expr;
  const obj = expr as Record<string, unknown>;
  if ("var" in obj) {
    return resolveVarPath(data, String(obj.var));
  }
  if ("==" in obj && Array.isArray(obj["=="])) {
    const [left, right] = obj["=="] as unknown[];
    return evalJsonLogicValue(left, data) === evalJsonLogicValue(right, data);
  }
  return expr;
}

function evalJsonLogicPredicate(exprJson: string, data: Record<string, unknown>): boolean {
  const expr = JSON.parse(exprJson) as unknown;
  const result = evalJsonLogicValue(expr, data);
  return Boolean(result);
}

async function evaluateLlmVerify(
  condition: SuccessCondition & { kind: "llm_verify" },
  input: SuccessVerifyInput,
  options: EvaluateSuccessOptions
): Promise<SuccessVerifyResult> {
  const mock = options.isMockProvider?.() ?? isMockProviderEnabled();
  if (mock) {
    const text = payloadAsString(input.payload);
    if (text.includes("VERIFY_FAIL")) {
      return { pass: false, reason: "mock_verify_fail" };
    }
    return { pass: true, reason: "mock_verify_pass" };
  }

  if (!options.judge) {
    return { pass: false, reason: "judge_unavailable" };
  }

  const raw = await options.judge({
    rubric: condition.rubric,
    payload: input.payload,
    credentialId: condition.credentialId,
    modelId: condition.modelId,
  });

  if (typeof raw.pass !== "boolean") {
    return FAIL_CLOSED;
  }
  return {
    pass: raw.pass,
    reason: typeof raw.reason === "string" ? raw.reason : undefined,
  };
}

export async function evaluateSuccessCondition(
  condition: SuccessCondition,
  input: SuccessVerifyInput,
  options: EvaluateSuccessOptions = {}
): Promise<SuccessVerifyResult> {
  try {
    switch (condition.kind) {
      case "signal": {
        const allowed = new Set<string>();
        if (input.successSignal) allowed.add(input.successSignal);
        for (const s of input.outgoingSignals ?? []) allowed.add(s);
        const pass = allowed.has(input.signal);
        return pass
          ? { pass: true }
          : { pass: false, reason: `signal mismatch: ${input.signal}` };
      }
      case "schema": {
        const target =
          input.payload !== undefined &&
          typeof input.payload === "object" &&
          input.payload !== null &&
          "payload" in (input.payload as object)
            ? (input.payload as { payload: unknown }).payload
            : input.payload;
        const result = validateWithMinimalSchema(target, condition.schema);
        return result.ok
          ? { pass: true }
          : { pass: false, reason: result.reason ?? "schema_fail" };
      }
      case "predicate": {
        const data = {
          payload: input.payload,
          signal: input.signal,
          stateId: input.stateId,
        };
        const pass = evalJsonLogicPredicate(condition.expr, data);
        return pass
          ? { pass: true }
          : { pass: false, reason: "predicate_false" };
      }
      case "llm_verify":
        return await evaluateLlmVerify(condition, input, options);
      default:
        return FAIL_CLOSED;
    }
  } catch {
    return FAIL_CLOSED;
  }
}
