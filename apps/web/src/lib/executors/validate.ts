import Ajv, { type ErrorObject } from "ajv";
import type { StateNodeData, ValidateStateConfig } from "@/lib/fsm-types";
import type { Executor, ExecutorContext } from "./types";

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false });

function formatAjvError(err: ErrorObject): string {
  const path = err.instancePath || "/";
  const missing =
    err.keyword === "required" &&
    err.params &&
    typeof (err.params as { missingProperty?: unknown }).missingProperty ===
      "string"
      ? `/${(err.params as { missingProperty: string }).missingProperty}`
      : "";
  return `${path}${missing} ${err.message ?? "invalid"}`.trim();
}

function schemaFromNode(
  data: StateNodeData | undefined,
  fallback: unknown
): { schema: object | null; error?: string } {
  const cfg: ValidateStateConfig | undefined = data?.validate;
  if (cfg?.kind === "predicate") {
    return {
      schema: null,
      error: "predicate validation is not implemented; use kind=schema",
    };
  }
  const raw = cfg?.schema;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { schema: parsed as object };
      }
      return { schema: null, error: "VALIDATE schema must be a JSON object" };
    } catch {
      return { schema: null, error: "VALIDATE schema is not valid JSON" };
    }
  }
  if (fallback && typeof fallback === "object") {
    return { schema: fallback as object };
  }
  return { schema: { type: "object" } };
}

export function createValidateExecutor(): Executor {
  return async function executeValidate(ctx: ExecutorContext) {
    const { schema, error } = schemaFromNode(
      ctx.node?.data,
      ctx.state.inputSchema
    );
    if (!schema) {
      const message = error ?? "VALIDATE schema missing";
      await ctx.emit({
        stateId: ctx.state.id,
        kind: "state.error",
        payload: { code: "VALIDATE_SCHEMA", message },
      });
      return {
        signal: "::VALIDATE.ERROR",
        payload: { message },
      };
    }

    let validateFn;
    try {
      validateFn = ajv.compile(schema);
    } catch (e) {
      const message = e instanceof Error ? e.message : "invalid JSON Schema";
      await ctx.emit({
        stateId: ctx.state.id,
        kind: "state.error",
        payload: { code: "VALIDATE_SCHEMA", message },
      });
      return {
        signal: "::VALIDATE.ERROR",
        payload: { message },
      };
    }

    const ok = validateFn(ctx.payload);
    if (ok) {
      return {
        signal: "::VALIDATE.NEXT",
        payload:
          ctx.payload && typeof ctx.payload === "object"
            ? (ctx.payload as Record<string, unknown>)
            : { value: ctx.payload },
      };
    }

    const ajvErrors = validateFn.errors ?? [];
    const message = ajvErrors.map(formatAjvError).join("; ") || "invalid payload";
    await ctx.emit({
      stateId: ctx.state.id,
      kind: "state.error",
      payload: {
        code: "VALIDATE",
        message,
        errors: ajvErrors.map((e) => ({
          instancePath: e.instancePath,
          message: e.message,
          keyword: e.keyword,
        })),
      },
    });
    return {
      signal: "::VALIDATE.ERROR",
      payload: { message },
    };
  };
}

export const executeValidate: Executor = createValidateExecutor();
