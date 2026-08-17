import { describe, expect, it, vi } from "vitest";
import type { StateNodeData } from "@/lib/fsm-types";
import {
  applyPayloadTemplate,
  createHttpExecutor,
  mapHttpStatusToSignal,
} from "./http";
import type { RunEventDraft } from "./types";

function httpNode(partial: Partial<StateNodeData["http"]> = {}): {
  id: string;
  data: StateNodeData;
} {
  return {
    id: "H1",
    data: {
      http: {
        method: "POST",
        urlTemplate: "https://api.example.com/items/{{payload.id}}",
        headers: {
          "X-Item": "{{payload.id}}",
          "Content-Type": "application/json",
        },
        bodyTemplate: '{"id":{{payload.id}},"name":"{{payload.name}}"}',
        successSignals: ["::HTTP.NEXT", "404: ::HTTP.NOT_FOUND"],
        ...partial,
      },
    } as StateNodeData,
  };
}

function ctx(args: {
  fetch: typeof fetch;
  payload?: unknown;
  timeoutMs?: number;
  retryMax?: number;
  retryBackoffMs?: number;
  signal?: AbortSignal;
  drafts?: RunEventDraft[];
}) {
  const drafts = args.drafts ?? [];
  return {
    drafts,
    execute: createHttpExecutor({ fetch: args.fetch, sleep: async () => undefined }),
    ctx: {
      runId: 1,
      state: {
        id: "H1",
        type: "HTTP",
        guardrails: {
          timeoutMs: args.timeoutMs ?? 5_000,
          retryMax: args.retryMax ?? 0,
          retryBackoffMs: args.retryBackoffMs ?? 0,
        },
      },
      node: httpNode(),
      payload: args.payload ?? { id: 42, name: "widget" },
      signal: args.signal ?? new AbortController().signal,
      emit: async (ev: RunEventDraft) => {
        drafts.push(ev);
      },
    },
  };
}

describe("HTTP templating", () => {
  it("substitutes {{payload.id}} in URL, headers, and body", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const fetchMock: typeof fetch = async (input, init) => {
      seenUrl = String(input);
      seenInit = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const { execute, ctx: c } = ctx({ fetch: fetchMock });
    const emission = await execute(c);
    expect(seenUrl).toBe("https://api.example.com/items/42");
    expect((seenInit?.headers as Record<string, string>)["X-Item"]).toBe("42");
    expect(seenInit?.body).toBe('{"id":42,"name":"widget"}');
    expect(emission).toMatchObject({ signal: "::HTTP.NEXT" });
  });

  it("applyPayloadTemplate walks dotted paths", () => {
    expect(
      applyPayloadTemplate("https://x/{{payload.user.id}}", {
        user: { id: "abc" },
      })
    ).toBe("https://x/abc");
  });
});

describe("HTTP status → signal", () => {
  it("maps 200→::HTTP.NEXT, 404→configured signal, 500→::HTTP.ERROR", () => {
    const signals = ["::HTTP.NEXT", "404: ::HTTP.NOT_FOUND"];
    expect(mapHttpStatusToSignal(200, signals)).toBe("::HTTP.NEXT");
    expect(mapHttpStatusToSignal(404, signals)).toBe("::HTTP.NOT_FOUND");
    expect(mapHttpStatusToSignal(500, signals)).toBe("::HTTP.ERROR");
  });

  it("emits the mapped signal from a live fetch", async () => {
    const fetchOf = (status: number): typeof fetch =>
      async () => new Response("{}", { status });

    const ok = ctx({ fetch: fetchOf(200) });
    expect(await ok.execute(ok.ctx)).toMatchObject({
      signal: "::HTTP.NEXT",
      payload: { status: 200 },
    });

    const missing = ctx({ fetch: fetchOf(404) });
    expect(await missing.execute(missing.ctx)).toMatchObject({
      signal: "::HTTP.NOT_FOUND",
      payload: { status: 404 },
    });

    const boom = ctx({ fetch: fetchOf(500) });
    expect(await boom.execute(boom.ctx)).toMatchObject({
      signal: "::HTTP.ERROR",
      payload: { status: 500 },
    });
    expect(boom.drafts.some((d) => d.kind === "state.error")).toBe(true);
  });
});

describe("HTTP SSRF guard", () => {
  it("refuses http://169.254.169.254/... with SSRF_BLOCKED before any fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const execute = createHttpExecutor({ fetch: fetchMock });
    const drafts: RunEventDraft[] = [];
    const emission = await execute({
      runId: 1,
      state: { id: "H1", type: "HTTP" },
      node: httpNode({
        method: "GET",
        urlTemplate: "http://169.254.169.254/latest/meta-data",
        headers: {},
        successSignals: ["::HTTP.NEXT"],
      }),
      payload: {},
      signal: new AbortController().signal,
      emit: async (ev) => {
        drafts.push(ev);
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(emission).toMatchObject({
      signal: "::HTTP.ERROR",
      payload: { code: "SSRF_BLOCKED" },
    });
    expect(drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "state.error",
          payload: expect.objectContaining({ code: "SSRF_BLOCKED" }),
        }),
      ])
    );
  });
});

describe("HTTP timeout", () => {
  it("aborts at timeoutMs and counts it as an attempt", async () => {
    const fetchMock: typeof fetch = async (_input, init) =>
      new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      });

    const { execute, ctx: c, drafts } = ctx({
      fetch: fetchMock,
      timeoutMs: 25,
      retryMax: 0,
    });
    const started = Date.now();
    const emission = await execute(c);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(emission).toMatchObject({
      signal: "::HTTP.ERROR",
      payload: { code: "TIMEOUT", attempts: 1 },
    });
    expect(drafts.some((d) => d.kind === "state.retry")).toBe(false);
    expect(drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "state.error",
          payload: expect.objectContaining({ code: "TIMEOUT", attempts: 1 }),
        }),
      ])
    );
  });
});
