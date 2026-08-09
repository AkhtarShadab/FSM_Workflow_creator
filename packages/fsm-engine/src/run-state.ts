import type { Emission } from "./signals";

export interface Guardrails {
  timeoutMs: number;
  retryMax: number;
  retryBackoffMs: number;
}

export interface RunStateSpec {
  id: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  guardrails: Guardrails;
  onErrorSignal: string;
  /** Injected executor — returns emission + optional payload */
  execute: (ctx: {
    payload: unknown;
    signal: AbortSignal;
  }) => Promise<Emission>;
}

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const defaultClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const t = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    }),
};

export type RunStateResult =
  | { ok: true; emission: Emission; attempts: number }
  | {
      ok: false;
      emission: Emission;
      attempts: number;
      reason: "input_schema" | "output_schema" | "timeout" | "execute" | "aborted";
      error?: string;
    };

function validateAgainstSchema(value: unknown, schema: unknown): boolean {
  if (schema == null || schema === "") return true;
  // Minimal structural check: if schema is object with type:object, value must be object
  if (typeof schema === "object" && schema !== null && "type" in schema) {
    const t = (schema as { type?: string }).type;
    if (t === "object") {
      return value !== null && typeof value === "object" && !Array.isArray(value);
    }
    if (t === "array") return Array.isArray(value);
    if (t === "string") return typeof value === "string";
    if (t === "number") return typeof value === "number";
    if (t === "boolean") return typeof value === "boolean";
  }
  return true;
}

/**
 * Enter → execute (with retries/timeout) → verify output → emit.
 */
export async function runState(
  spec: RunStateSpec,
  inputPayload: unknown,
  opts: { clock?: Clock; abortSignal?: AbortSignal } = {}
): Promise<RunStateResult> {
  const clock = opts.clock ?? defaultClock;

  if (!validateAgainstSchema(inputPayload, spec.inputSchema)) {
    return {
      ok: false,
      emission: spec.onErrorSignal,
      attempts: 0,
      reason: "input_schema",
      error: "input schema validation failed",
    };
  }

  const maxAttempts = Math.max(1, spec.guardrails.retryMax + 1);
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.abortSignal?.aborted) {
      return {
        ok: false,
        emission: spec.onErrorSignal,
        attempts: attempt - 1,
        reason: "aborted",
      };
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    opts.abortSignal?.addEventListener("abort", onAbort, { once: true });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(1, spec.guardrails.timeoutMs));

    try {
      const emission = await spec.execute({
        payload: inputPayload,
        signal: controller.signal,
      });

      clearTimeout(timer);
      opts.abortSignal?.removeEventListener("abort", onAbort);

      // Optional output schema on structured emissions with payload
      const outPayload =
        typeof emission === "object" && emission && "payload" in emission
          ? emission.payload
          : inputPayload;

      if (!validateAgainstSchema(outPayload, spec.outputSchema)) {
        lastError = "output schema validation failed";
        if (attempt < maxAttempts) {
          await clock.sleep(spec.guardrails.retryBackoffMs, opts.abortSignal);
          continue;
        }
        return {
          ok: false,
          emission: spec.onErrorSignal,
          attempts: attempt,
          reason: "output_schema",
          error: lastError,
        };
      }

      return { ok: true, emission, attempts: attempt };
    } catch (err) {
      clearTimeout(timer);
      opts.abortSignal?.removeEventListener("abort", onAbort);
      lastError = err instanceof Error ? err.message : String(err);

      if (timedOut) {
        if (attempt < maxAttempts) {
          await clock.sleep(spec.guardrails.retryBackoffMs, opts.abortSignal);
          continue;
        }
        return {
          ok: false,
          emission: spec.onErrorSignal,
          attempts: attempt,
          reason: "timeout",
          error: lastError,
        };
      }

      if (attempt < maxAttempts) {
        await clock.sleep(spec.guardrails.retryBackoffMs, opts.abortSignal);
        continue;
      }

      return {
        ok: false,
        emission: spec.onErrorSignal,
        attempts: attempt,
        reason: "execute",
        error: lastError,
      };
    }
  }

  return {
    ok: false,
    emission: spec.onErrorSignal,
    attempts: maxAttempts,
    reason: "execute",
    error: lastError,
  };
}
