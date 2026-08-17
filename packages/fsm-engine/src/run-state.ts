import type { Emission } from "./signals";
import {
  DEFAULT_RETRY_ON,
  type RetryReason,
} from "./signals";

export type { RetryReason };

export interface Guardrails {
  timeoutMs: number;
  retryMax: number;
  retryBackoffMs: number;
  retryOn?: RetryReason[];
}

const MAX_BACKOFF_MS = 30_000;

export function resolveRetryOn(guardrails: Guardrails): RetryReason[] {
  return guardrails.retryOn ?? DEFAULT_RETRY_ON;
}

/** Exponential backoff: base * 2^(attempt-1), capped at 30s. */
export function retryBackoffMs(guardrails: Guardrails, attempt: number): number {
  const base = guardrails.retryBackoffMs;
  return Math.min(base * 2 ** (attempt - 1), MAX_BACKOFF_MS);
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
      reason:
        | "input_schema"
        | "output_schema"
        | "timeout"
        | "execute"
        | "verify_fail"
        | "tool_denied"
        | "aborted";
      error?: string;
    };

export interface RunStateOptions {
  clock?: Clock;
  abortSignal?: AbortSignal;
  onRetry?: (info: {
    attempt: number;
    reason: RetryReason;
  }) => void | Promise<void>;
}

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

async function scheduleRetry(
  reason: RetryReason,
  attempt: number,
  maxAttempts: number,
  guardrails: Guardrails,
  retryOn: RetryReason[],
  clock: Clock,
  abortSignal: AbortSignal | undefined,
  onRetry: RunStateOptions["onRetry"]
): Promise<boolean> {
  if (attempt >= maxAttempts || !retryOn.includes(reason)) {
    return false;
  }
  await onRetry?.({ attempt, reason });
  await clock.sleep(retryBackoffMs(guardrails, attempt), abortSignal);
  return true;
}

/**
 * Enter → execute (with retries/timeout) → verify output → emit.
 */
export async function runState(
  spec: RunStateSpec,
  inputPayload: unknown,
  opts: RunStateOptions = {}
): Promise<RunStateResult> {
  const clock = opts.clock ?? defaultClock;
  const retryOn = resolveRetryOn(spec.guardrails);

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

      const outPayload =
        typeof emission === "object" && emission && "payload" in emission
          ? emission.payload
          : inputPayload;

      if (!validateAgainstSchema(outPayload, spec.outputSchema)) {
        lastError = "output schema validation failed";
        if (
          await scheduleRetry(
            "output_schema",
            attempt,
            maxAttempts,
            spec.guardrails,
            retryOn,
            clock,
            opts.abortSignal,
            opts.onRetry
          )
        ) {
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

      const reason: RetryReason = timedOut ? "timeout" : "execute";
      if (
        await scheduleRetry(
          reason,
          attempt,
          maxAttempts,
          spec.guardrails,
          retryOn,
          clock,
          opts.abortSignal,
          opts.onRetry
        )
      ) {
        continue;
      }

      return {
        ok: false,
        emission: spec.onErrorSignal,
        attempts: attempt,
        reason,
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
