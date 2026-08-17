export type HumanDecision = "approved" | "rejected" | "expired";

export interface HumanResolution {
  signal: string;
  decision: HumanDecision;
  response?: unknown;
}

export function signalForDecision(decision: HumanDecision): string {
  return decision === "approved" ? "::HUMAN.APPROVE" : "::HUMAN.REJECT";
}

function waiterKey(runId: number, taskId: number): string {
  return `${runId}:${taskId}`;
}

export interface HumanWaitArgs {
  runId: number;
  taskId: number;
  expiresAt?: Date | null;
  signal: AbortSignal;
  onExpire?: () => Promise<void> | void;
}

export interface HumanBridge {
  wait(args: HumanWaitArgs): Promise<HumanResolution>;
  resolve(runId: number, taskId: number, resolution: HumanResolution): boolean;
  has(runId: number, taskId: number): boolean;
}

export function createHumanBridge(): HumanBridge {
  const waiters = new Map<string, { resolve: (r: HumanResolution) => void }>();

  return {
    wait(args) {
      const k = waiterKey(args.runId, args.taskId);
      return new Promise<HumanResolution>((resolve, reject) => {
        if (args.signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }

        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const settle = (r: HumanResolution) => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          args.signal.removeEventListener("abort", onAbort);
          waiters.delete(k);
          resolve(r);
        };

        const onAbort = () => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          waiters.delete(k);
          reject(new DOMException("Aborted", "AbortError"));
        };

        waiters.set(k, { resolve: settle });
        args.signal.addEventListener("abort", onAbort, { once: true });

        if (args.expiresAt) {
          const ms = args.expiresAt.getTime() - Date.now();
          timer = setTimeout(() => {
            void Promise.resolve(args.onExpire?.()).finally(() => {
              settle({
                signal: signalForDecision("expired"),
                decision: "expired",
              });
            });
          }, Math.max(0, ms));
        }
      });
    },
    resolve(runId, taskId, resolution) {
      const w = waiters.get(waiterKey(runId, taskId));
      if (!w) return false;
      w.resolve(resolution);
      return true;
    },
    has(runId, taskId) {
      return waiters.has(waiterKey(runId, taskId));
    },
  };
}

/** Process-wide waiters used by the live HUMAN executor and approval API. */
export const defaultHumanBridge = createHumanBridge();
