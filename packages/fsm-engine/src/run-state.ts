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
    if (t === "number") return typeof value === "number" && Number.isFinite(value);
    if (t === "integer") return Number.isInteger(value);
    if (t === "null") return value === null;
    if (t === "boolean") return typeof value === "boolean";
  }
  return true;
}

function abortError(): Error {
  return new DOMException("Aborted", "AbortError");
}

/**
 * Settle with `p`, or reject as soon as `signal` aborts — whichever comes
 * first. Guarantees guardrail timeouts / parent aborts are enforced even when
 * an executor ignores its AbortSignal.
 */
export function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    p.catch(() => {});
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    );
  });
}

/**
 * Enter → execute (with retries/timeout) → verify output → emit.
 *
 * - `guardrails.timeoutMs` is enforced even if the executor never settles.
 * - A parent abort (opts.abortSignal) always resolves with reason "aborted"
 *   (it never throws and never burns retries).
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

  const aborted = (attempts: number): RunStateResult => ({
    ok: false,
    emission: spec.onErrorSignal,
    attempts,
    reason: "aborted",
    ...(lastError ? { error: lastError } : {}),
  });

  /** Sleep between attempts; false when the parent aborted meanwhile. */
  const backoff = async (): Promise<boolean> => {
    try {
      await clock.sleep(spec.guardrails.retryBackoffMs, opts.abortSignal);
      return !opts.abortSignal?.aborted;
    } catch {
      return false;
    }
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.abortSignal?.aborted) return aborted(attempt - 1);

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    opts.abortSignal?.addEventListener("abort", onAbort, { once: true });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(1, spec.guardrails.timeoutMs));

    const done = () => {
      clearTimeout(timer);
      opts.abortSignal?.removeEventListener("abort", onAbort);
    };

    let emission: Emission;
    try {
      emission = await raceAbort(
        Promise.resolve().then(() =>
          spec.execute({ payload: inputPayload, signal: controller.signal })
        ),
        controller.signal
      );
      done();
    } catch (err) {
      done();
      lastError = err instanceof Error ? err.message : String(err);

      if (timedOut) {
        if (attempt < maxAttempts) {
          if (!(await backoff())) return aborted(attempt);
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

      if (opts.abortSignal?.aborted) return aborted(attempt);

      if (attempt < maxAttempts) {
        if (!(await backoff())) return aborted(attempt);
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

    // Optional output schema on structured emissions with payload
    const outPayload =
      typeof emission === "object" && emission && "payload" in emission
        ? emission.payload
        : inputPayload;

    if (!validateAgainstSchema(outPayload, spec.outputSchema)) {
      lastError = "output schema validation failed";
      if (attempt < maxAttempts) {
        if (!(await backoff())) return aborted(attempt);
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
  }

  return {
    ok: false,
    emission: spec.onErrorSignal,
    attempts: maxAttempts,
    reason: "execute",
    error: lastError,
  };
}
