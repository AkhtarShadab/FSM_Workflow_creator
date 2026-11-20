import { raceAbort } from "./run-state";

export type ChildStatus = "ok" | "error" | "timeout" | "cancelled";

export interface ChildEnvelope {
  childId: string;
  profileId: string;
  status: ChildStatus;
  payload?: unknown;
  error?: string;
}

export interface ChildProfile {
  id: string;
  toolPack: string[];
  skillPack: string[];
  timeoutMs?: number;
}

export interface SpawnPoolConfig {
  mode: "homogeneous" | "heterogeneous";
  count: number;
  maxConcurrency: number;
  strategy: "waitAll" | "quorum" | "firstSuccess";
  quorumK?: number;
  cancelOnParentHalt: boolean;
  profiles: ChildProfile[];
}

export interface ChildContext {
  childId: string;
  profileId: string;
  toolPack: string[];
  skillPack: string[];
  signal: AbortSignal;
  index: number;
}

export type ChildExecutor = (ctx: ChildContext) => Promise<unknown>;

/**
 * Async in-process worker pool (v1 — worker_threads deferred).
 * Quorum keeps error envelopes in the aggregate array.
 *
 * Envelope status rules:
 * - `timeout`   — the child's own `timeoutMs` elapsed.
 * - `cancelled` — the pool stopped it (firstSuccess / quorum reached, or the
 *                 parent halted with `cancelOnParentHalt`), or it never started.
 * - `error`     — the executor threw / rejected on its own.
 * Children that ignore their AbortSignal are still settled on abort, so a
 * hung child can never hang the pool.
 */
export async function runSpawn(
  config: SpawnPoolConfig,
  executeChild: ChildExecutor,
  opts: { parentSignal?: AbortSignal } = {}
): Promise<ChildEnvelope[]> {
  const maxConc = Math.max(1, Math.floor(config.maxConcurrency) || 1);
  const profiles = resolveProfiles(config);
  const envelopes: ChildEnvelope[] = new Array(profiles.length);
  let inFlight = 0;
  let nextIndex = 0;
  let settledOk = 0;
  let stopScheduling = false;
  let finished = false;
  const childControllers: AbortController[] = [];
  /** Children aborted by the pool itself (not by their own timeout). */
  const poolCancelled = new Set<number>();

  const cancelInFlight = () => {
    stopScheduling = true;
    childControllers.forEach((c, i) => {
      if (c && !envelopes[i] && !c.signal.aborted) {
        poolCancelled.add(i);
        c.abort();
      }
    });
  };

  const parentAbort = () => {
    if (config.cancelOnParentHalt) cancelInFlight();
  };

  return new Promise((resolve) => {
    const cleanup = () => {
      opts.parentSignal?.removeEventListener("abort", parentAbort);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      for (let i = 0; i < profiles.length; i++) {
        if (!envelopes[i]) {
          envelopes[i] = {
            childId: `child_${i}`,
            profileId: profiles[i].id,
            status: "cancelled",
          };
        }
      }
      cleanup();
      resolve(envelopes);
    };

    const maybeFinish = () => {
      if (finished) return;

      const quorumReached =
        config.strategy === "quorum" &&
        settledOk >= Math.max(1, config.quorumK ?? 1);
      const firstReached =
        config.strategy === "firstSuccess" && settledOk >= 1;
      if (quorumReached || firstReached) cancelInFlight();

      if (stopScheduling && inFlight === 0) {
        finish();
        return;
      }
      if (envelopes.filter(Boolean).length === profiles.length) finish();
    };

    const pump = () => {
      while (
        !stopScheduling &&
        inFlight < maxConc &&
        nextIndex < profiles.length
      ) {
        const index = nextIndex++;
        const profile = profiles[index];
        const controller = new AbortController();
        childControllers[index] = controller;
        inFlight += 1;

        let timedOut = false;
        const timeoutMs = profile.timeoutMs ?? 30_000;
        const timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, Math.max(1, timeoutMs));

        void (async () => {
          try {
            const payload = await raceAbort(
              Promise.resolve().then(() =>
                executeChild({
                  childId: `child_${index}`,
                  profileId: profile.id,
                  toolPack: profile.toolPack,
                  skillPack: profile.skillPack,
                  signal: controller.signal,
                  index,
                })
              ),
              controller.signal
            );
            envelopes[index] = {
              childId: `child_${index}`,
              profileId: profile.id,
              status: "ok",
              payload,
            };
            settledOk += 1;
          } catch (err) {
            const status: ChildStatus = poolCancelled.has(index)
              ? "cancelled"
              : timedOut
                ? "timeout"
                : controller.signal.aborted
                  ? "cancelled"
                  : "error";
            envelopes[index] = {
              childId: `child_${index}`,
              profileId: profile.id,
              status,
              error: err instanceof Error ? err.message : String(err),
            };
          } finally {
            clearTimeout(timer);
            inFlight -= 1;
            maybeFinish();
            pump();
          }
        })();
      }
      maybeFinish();
    };

    if (opts.parentSignal?.aborted && config.cancelOnParentHalt) {
      stopScheduling = true;
      finish();
      return;
    }
    opts.parentSignal?.addEventListener("abort", parentAbort, { once: true });
    pump();
  });
}

function resolveProfiles(config: SpawnPoolConfig): ChildProfile[] {
  if (config.mode === "heterogeneous") {
    // X = profiles.length for heterogeneous spawns (matches the web
    // `spawnWorkerCount`); `count` is only a homogeneous replica count.
    return config.profiles.slice();
  }
  const count = Math.max(0, Math.floor(config.count) || 0);
  const base = config.profiles[0] ?? {
    id: "default",
    toolPack: [],
    skillPack: [],
  };
  return Array.from({ length: count }, (_, i) => ({
    ...base,
    id: config.profiles[0]?.id ?? `p${i}`,
  }));
}

/** Test helper: peak in-flight counter via instrumented executor wrapper */
export function withInFlightProbe(executeChild: ChildExecutor): {
  execute: ChildExecutor;
  peak: () => number;
} {
  let current = 0;
  let peak = 0;
  return {
    peak: () => peak,
    execute: async (ctx) => {
      current += 1;
      peak = Math.max(peak, current);
      try {
        return await executeChild(ctx);
      } finally {
        current -= 1;
      }
    },
  };
}
