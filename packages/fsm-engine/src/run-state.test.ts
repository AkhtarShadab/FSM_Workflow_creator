import { describe, expect, it } from "vitest";
import {
  runState,
  retryBackoffMs,
  type Clock,
} from "./run-state";

describe("runState R1 retry contract", () => {
  const noopClock: Clock = {
    now: () => 0,
    sleep: async () => undefined,
  };

  it("times out, retries twice, then fails with onErrorSignal", async () => {
    let attempts = 0;
    const retries: Array<{ attempt: number; reason: string }> = [];

    const r = await runState(
      {
        id: "S1",
        guardrails: {
          timeoutMs: 20,
          retryMax: 2,
          retryBackoffMs: 10,
        },
        onErrorSignal: "::SCRIPT.ERROR",
        execute: async ({ signal }) => {
          attempts += 1;
          return new Promise((_, reject) => {
            signal.addEventListener("abort", () =>
              reject(new Error("aborted"))
            );
          });
        },
      },
      {},
      {
        clock: noopClock,
        onRetry: (info) => retries.push(info),
      }
    );

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("timeout");
      expect(r.attempts).toBe(3);
      expect(r.emission).toBe("::SCRIPT.ERROR");
    }
    expect(attempts).toBe(3);
    expect(retries).toEqual([
      { attempt: 1, reason: "timeout" },
      { attempt: 2, reason: "timeout" },
    ]);
  });

  it("does not retry timeouts when retryOn excludes timeout", async () => {
    let attempts = 0;
    const retries: Array<{ attempt: number; reason: string }> = [];

    const r = await runState(
      {
        id: "S1",
        guardrails: {
          timeoutMs: 20,
          retryMax: 2,
          retryBackoffMs: 10,
          retryOn: ["execute", "output_schema"],
        },
        onErrorSignal: "::SCRIPT.ERROR",
        execute: async ({ signal }) => {
          attempts += 1;
          return new Promise((_, reject) => {
            signal.addEventListener("abort", () =>
              reject(new Error("aborted"))
            );
          });
        },
      },
      {},
      {
        clock: noopClock,
        onRetry: (info) => retries.push(info),
      }
    );

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("timeout");
      expect(r.attempts).toBe(1);
    }
    expect(attempts).toBe(1);
    expect(retries).toHaveLength(0);
  });

  it("succeeds on first attempt without onRetry", async () => {
    const retries: Array<{ attempt: number; reason: string }> = [];

    const r = await runState(
      {
        id: "S1",
        guardrails: { timeoutMs: 1000, retryMax: 2, retryBackoffMs: 10 },
        onErrorSignal: "::SCRIPT.ERROR",
        execute: async () => "::SCRIPT.NEXT",
      },
      {},
      {
        clock: noopClock,
        onRetry: (info) => retries.push(info),
      }
    );

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.emission).toBe("::SCRIPT.NEXT");
      expect(r.attempts).toBe(1);
    }
    expect(retries).toHaveLength(0);
  });

  it("applies exponential backoff capped at 30s", () => {
    const guardrails = { timeoutMs: 1000, retryMax: 5, retryBackoffMs: 1000 };
    expect(retryBackoffMs(guardrails, 1)).toBe(1000);
    expect(retryBackoffMs(guardrails, 2)).toBe(2000);
    expect(retryBackoffMs(guardrails, 3)).toBe(4000);
    expect(retryBackoffMs(guardrails, 10)).toBe(30_000);
  });

  it("uses exponential backoff between retries", async () => {
    const sleeps: number[] = [];
    const clock: Clock = {
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    };
    let attempts = 0;

    await runState(
      {
        id: "S1",
        guardrails: {
          timeoutMs: 1000,
          retryMax: 2,
          retryBackoffMs: 100,
        },
        onErrorSignal: "::SCRIPT.ERROR",
        execute: async () => {
          attempts += 1;
          throw new Error("boom");
        },
      },
      {},
      { clock }
    );

    expect(attempts).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });
});
