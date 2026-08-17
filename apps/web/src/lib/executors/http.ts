import type { HttpConfig, HttpMethod, StateNodeData } from "@/lib/fsm-types";
import { validatePublicHttpUrl } from "@/lib/url-guard";
import type { Executor, ExecutorContext } from "./types";

export interface HttpExecutorDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const DEFAULT_SLEEP = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
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
  });

const TEMPLATE_RE = /\{\{\s*payload\.([^}]+?)\s*\}\}/g;
const STATUS_SIGNAL_RE = /^\s*(\d{3})\s*[:=>]\s*(::\S+)\s*$/;

function lookupPath(payload: unknown, path: string): unknown {
  if (payload == null) return undefined;
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  let cur: unknown = payload;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function stringifyTemplateValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Replace `{{payload.x}}` (and dotted paths) using the current payload. */
export function applyPayloadTemplate(template: string, payload: unknown): string {
  return template.replace(TEMPLATE_RE, (_m, rawPath: string) =>
    stringifyTemplateValue(lookupPath(payload, String(rawPath).trim()))
  );
}

export function parseSuccessSignals(signals: string[] | undefined): {
  byStatus: Map<number, string>;
  defaultSignal: string;
} {
  const byStatus = new Map<number, string>();
  let defaultSignal = "::HTTP.NEXT";
  let sawBare = false;
  for (const raw of signals ?? []) {
    const mapped = raw.match(STATUS_SIGNAL_RE);
    if (mapped) {
      byStatus.set(Number(mapped[1]), mapped[2]);
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.startsWith("::") && !sawBare) {
      defaultSignal = trimmed;
      sawBare = true;
    }
  }
  return { byStatus, defaultSignal };
}

/** Status → signal: 2xx uses successSignals; explicit `404: ::SIG`; 5xx → `::HTTP.ERROR`. */
export function mapHttpStatusToSignal(
  status: number,
  successSignals: string[] | undefined
): string {
  const { byStatus, defaultSignal } = parseSuccessSignals(successSignals);
  const explicit = byStatus.get(status);
  if (explicit) return explicit;
  if (status >= 200 && status < 300) return defaultSignal;
  return "::HTTP.ERROR";
}

function httpConfigFromNode(data: StateNodeData | undefined): HttpConfig {
  const h = data?.http;
  return {
    method: (h?.method ?? "GET") as HttpMethod,
    urlTemplate: h?.urlTemplate ?? "",
    authCredentialId: h?.authCredentialId,
    headers: h?.headers ?? {},
    bodyTemplate: h?.bodyTemplate,
    successSignals: h?.successSignals ?? ["::HTTP.NEXT"],
  };
}

function parseResponseBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return text;
  }
}

function linkTimeout(
  parent: AbortSignal,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const ac = new AbortController();
  let timedOut = false;
  const onParent = () => ac.abort();
  if (parent.aborted) {
    ac.abort();
  } else {
    parent.addEventListener("abort", onParent);
  }
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, Math.max(1, timeoutMs));
  return {
    signal: ac.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParent);
    },
    timedOut: () => timedOut && !parent.aborted,
  };
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return parseResponseBody(await res.text());
  } catch {
    return null;
  }
}

export function createHttpExecutor(deps: HttpExecutorDeps = {}): Executor {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? DEFAULT_SLEEP;

  return async function executeHttp(ctx: ExecutorContext) {
    const cfg = httpConfigFromNode(ctx.node?.data);
    const retryMax = ctx.state.guardrails?.retryMax ?? 0;
    const backoff = ctx.state.guardrails?.retryBackoffMs ?? 0;
    const timeoutMs = ctx.state.guardrails?.timeoutMs ?? 30_000;
    const maxAttempts = Math.max(1, retryMax + 1);

    const url = applyPayloadTemplate(cfg.urlTemplate, ctx.payload);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg.headers ?? {})) {
      headers[k] = applyPayloadTemplate(v, ctx.payload);
    }
    const bodyRaw =
      cfg.bodyTemplate != null && cfg.bodyTemplate !== ""
        ? applyPayloadTemplate(cfg.bodyTemplate, ctx.payload)
        : undefined;

    const guard = validatePublicHttpUrl(url);
    if (!guard.ok) {
      await ctx.emit({
        stateId: ctx.state.id,
        kind: "state.error",
        payload: { code: "SSRF_BLOCKED", error: guard.error, url },
      });
      return {
        signal: "::HTTP.ERROR",
        payload: { code: "SSRF_BLOCKED", error: guard.error },
      };
    }

    let lastError = "HTTP_ERROR";
    let attempts = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      if (ctx.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const linked = linkTimeout(ctx.signal, timeoutMs);
      try {
        const method = (cfg.method ?? "GET").toUpperCase();
        const init: RequestInit = {
          method,
          headers,
          signal: linked.signal,
        };
        if (
          bodyRaw != null &&
          method !== "GET" &&
          method !== "HEAD"
        ) {
          init.body = bodyRaw;
        }

        const res = await doFetch(url, init);
        linked.cleanup();

        const body = await readBody(res);
        const signal = mapHttpStatusToSignal(res.status, cfg.successSignals);

        if (signal === "::HTTP.ERROR") {
          await ctx.emit({
            stateId: ctx.state.id,
            kind: "state.error",
            payload: {
              code: "HTTP_STATUS",
              status: res.status,
              attempts: attempt,
            },
          });
          return {
            signal: "::HTTP.ERROR",
            payload: { status: res.status, body, attempts: attempt },
          };
        }

        return {
          signal,
          payload: { status: res.status, body, attempts: attempt },
        };
      } catch (e) {
        linked.cleanup();
        if (ctx.signal.aborted) {
          throw e instanceof DOMException
            ? e
            : new DOMException("Aborted", "AbortError");
        }
        const isAbort =
          (e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError");
        lastError = linked.timedOut() || isAbort ? "TIMEOUT" : "FETCH";
        if (attempt >= maxAttempts) {
          await ctx.emit({
            stateId: ctx.state.id,
            kind: "state.error",
            payload: { code: lastError, attempts: attempt },
          });
          return {
            signal: "::HTTP.ERROR",
            payload: { code: lastError, attempts: attempt },
          };
        }
        await ctx.emit({
          stateId: ctx.state.id,
          kind: "state.retry",
          payload: { attempt, code: lastError },
        });
        if (backoff > 0) await sleep(backoff, ctx.signal);
      }
    }

    await ctx.emit({
      stateId: ctx.state.id,
      kind: "state.error",
      payload: { code: lastError, attempts },
    });
    return {
      signal: "::HTTP.ERROR",
      payload: { code: lastError, attempts },
    };
  };
}

export const executeHttp: Executor = createHttpExecutor();
