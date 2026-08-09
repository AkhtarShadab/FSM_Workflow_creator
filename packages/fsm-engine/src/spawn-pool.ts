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
 */
export async function runSpawn(
  config: SpawnPoolConfig,
  executeChild: ChildExecutor,
  opts: { parentSignal?: AbortSignal } = {}
): Promise<ChildEnvelope[]> {
  const maxConc = Math.max(1, config.maxConcurrency);
  const profiles = resolveProfiles(config);
  const envelopes: ChildEnvelope[] = new Array(profiles.length);
  let inFlight = 0;
  let nextIndex = 0;
  let settledOk = 0;
  let stopScheduling = false;
  const childControllers: AbortController[] = [];

  const parentAbort = () => {
    if (config.cancelOnParentHalt) {
      stopScheduling = true;
      for (const c of childControllers) c.abort();
    }
  };
  opts.parentSignal?.addEventListener("abort", parentAbort, { once: true });

  return new Promise((resolve) => {
    const maybeFinish = () => {
      const done = envelopes.filter(Boolean).length;
      if (stopScheduling && inFlight === 0) {
        // fill remaining as cancelled
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
        return;
      }

      if (config.strategy === "firstSuccess" && settledOk >= 1) {
        stopScheduling = true;
        for (const c of childControllers) c.abort();
        if (inFlight === 0) {
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
        }
        return;
      }

      if (
        config.strategy === "quorum" &&
        settledOk >= Math.max(1, config.quorumK ?? 1)
      ) {
        stopScheduling = true;
        for (const c of childControllers) c.abort();
        if (inFlight === 0) {
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
        }
        return;
      }

      if (done === profiles.length) {
        cleanup();
        resolve(envelopes);
      }
    };

    const cleanup = () => {
      opts.parentSignal?.removeEventListener("abort", parentAbort);
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

        const timeoutMs = profile.timeoutMs ?? 30_000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        void (async () => {
          try {
            const payload = await executeChild({
              childId: `child_${index}`,
              profileId: profile.id,
              toolPack: profile.toolPack,
              skillPack: profile.skillPack,
              signal: controller.signal,
              index,
            });
            clearTimeout(timer);
            envelopes[index] = {
              childId: `child_${index}`,
              profileId: profile.id,
              status: "ok",
              payload,
            };
            settledOk += 1;
          } catch (err) {
            clearTimeout(timer);
            const aborted = controller.signal.aborted;
            const isTimeout =
              aborted &&
              !(opts.parentSignal?.aborted && config.cancelOnParentHalt);
            envelopes[index] = {
              childId: `child_${index}`,
              profileId: profile.id,
              status: aborted
                ? opts.parentSignal?.aborted && config.cancelOnParentHalt
                  ? "cancelled"
                  : isTimeout
                    ? "timeout"
                    : "cancelled"
                : "error",
              error: err instanceof Error ? err.message : String(err),
            };
          } finally {
            inFlight -= 1;
            pump();
            maybeFinish();
          }
        })();
      }
      maybeFinish();
    };

    pump();
  });
}

function resolveProfiles(config: SpawnPoolConfig): ChildProfile[] {
  if (config.mode === "heterogeneous") {
    return config.profiles.slice(0, config.count);
  }
  const base = config.profiles[0] ?? {
    id: "default",
    toolPack: [],
    skillPack: [],
  };
  return Array.from({ length: config.count }, (_, i) => ({
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
