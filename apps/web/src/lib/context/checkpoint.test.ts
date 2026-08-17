import { describe, expect, it } from "vitest";
import { estimateTokens } from "./phase-map";
import {
  LLM_SUMMARY_TOKEN_CAP,
  capTokens,
  collectToolSchemas,
  createMemoryCheckpointStore,
  dehydrate,
  extractVars,
  hydrate,
  runCheckpointBoundary,
  summarizeTemplate,
  summarizeWithStrategy,
  type HistoryMessage,
} from "./checkpoint";
import type { FsmDsl } from "./phase-map";

function msg(
  stateId: string,
  content: string,
  extra?: Partial<HistoryMessage>
): HistoryMessage {
  return { stateId, role: extra?.role ?? "assistant", content, vars: extra?.vars };
}

function longHistory(n = 12): HistoryMessage[] {
  return Array.from({ length: n }, (_, i) =>
    msg(
      i < 6 ? "S1" : "S2",
      `Cluster work item ${i} with a substantial payload blob ${"x".repeat(80)} pages=${100 + i} topic=ingest`
    )
  );
}

const twoClusterDsl: FsmDsl = {
  name: "two-cluster",
  clusters: [
    { id: "ingest", label: "Ingest", states: ["S1", "S2"] },
    { id: "transform", label: "Transform", states: ["T1", "T2"] },
  ],
  states: [
    { id: "S0", type: "START", label: "Start" },
    {
      id: "S1",
      type: "SCRIPT",
      tool: {
        name: "fetch_pages",
        schema: { type: "object", properties: { url: { type: "string" } } },
      },
    },
    {
      id: "S2",
      type: "AI",
      tool: {
        name: "parse_html",
        schema: { type: "object", properties: { html: { type: "string" } } },
      },
    },
    {
      id: "SF1",
      type: "SYSTEM_FUNCTION",
      checkpoint: {
        summaryStrategy: "template",
        dehydrateClusters: ["ingest"],
        hydrateCluster: "transform",
        enabledStateIds: ["T1", "T2"],
      },
    },
    {
      id: "T1",
      type: "SCRIPT",
      tool: {
        name: "embed",
        schema: { type: "object", properties: { text: { type: "string" } } },
      },
    },
    {
      id: "T2",
      type: "AI",
      tool: {
        name: "write_index",
        schema: { type: "object", properties: { vec: { type: "array" } } },
      },
    },
    { id: "END", type: "END" },
  ],
};

describe("template summarizer", () => {
  it("is deterministic and preserves extracted variables across two identical inputs", () => {
    const history = [
      msg("S1", "start pages=12 source=web", { vars: { run: "alpha" } }),
      msg("S1", '{"topic":"ingest","count":4}'),
      msg("S2", "done pages=12 leftover=no"),
    ];
    const a = summarizeTemplate(history);
    const b = summarizeTemplate(history);
    expect(a).toBe(b);
    expect(a).toContain("pages=12");
    expect(a).toContain("source=web");
    expect(a).toContain("topic=ingest");
    expect(a).toContain("count=4");
    expect(a).toContain("run=alpha");
    expect(extractVars(history)).toEqual(extractVars([...history]));
    expect(extractVars(history).pages).toBe("12");
  });

  it("keeps first and last N without duplicating a short window", () => {
    const history = longHistory(12);
    const summary = summarizeTemplate(history, { firstN: 3, lastN: 3 });
    expect(summary).toContain("first 3:");
    expect(summary).toContain("last 3:");
    expect(summary).toContain("[0] S1");
    expect(summary).toContain("[11] S2");
    expect(summary).not.toContain("[5]");
  });
});

describe("llm summarizer", () => {
  it("truncates output at 500 tokens", async () => {
    const huge = "word ".repeat(800);
    expect(estimateTokens(huge)).toBeGreaterThan(LLM_SUMMARY_TOKEN_CAP);
    const result = await summarizeWithStrategy([msg("S1", "hello")], "llm", {
      llm: async () => huge,
    });
    expect(result.strategy).toBe("llm");
    expect(estimateTokens(result.summary)).toBeLessThanOrEqual(LLM_SUMMARY_TOKEN_CAP);
    expect(capTokens(huge, LLM_SUMMARY_TOKEN_CAP)).toBe(result.summary);
  });

  it("falls back to template when the provider throws", async () => {
    const history = [msg("S1", "pages=9 keep=yes")];
    const template = summarizeTemplate(history);
    const result = await summarizeWithStrategy(history, "llm", {
      llm: async () => {
        throw new Error("provider down");
      },
    });
    expect(result.strategy).toBe("template");
    expect(result.summary).toBe(template);
    expect(result.warning).toMatch(/fell back to template/);
    expect(result.warning).toMatch(/provider down/);
  });
});

describe("dehydrate / hydrate", () => {
  it("round-trips finished-cluster history and reports tokensSaved > 0", async () => {
    const history = longHistory(16);
    const store = createMemoryCheckpointStore();
    const dehydrated = await dehydrate({
      runId: 7,
      stateId: "SF1",
      seq: 0,
      history,
      finishedStateIds: ["S1", "S2"],
      strategy: "template",
      store,
    });
    expect(dehydrated.record.key).toBe("run:7:cp:0");
    expect(dehydrated.finishedHistory.length).toBe(16);
    expect(JSON.parse(dehydrated.record.historyJson)).toEqual(
      dehydrated.finishedHistory
    );
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.key).toBe("run:7:cp:0");

    const hydrated = hydrate({
      record: dehydrated.record,
      nextSchemas: collectToolSchemas(twoClusterDsl, ["T1", "T2"]),
      finishedHistory: dehydrated.finishedHistory,
      phaseMap: {
        clusters: [
          { id: "ingest", label: "Ingest", summary: "Fetch", stateCount: 2 },
          { id: "transform", label: "Transform", summary: "Embed", stateCount: 2 },
        ],
        estimatedTokens: 40,
      },
    });
    expect(hydrated.lossy).toBe(false);
    expect(hydrated.storedHistory).toEqual(dehydrated.finishedHistory);
    expect(hydrated.text).toContain("Checkpoint summary:");
    expect(hydrated.text).toContain("Phase map:");
    expect(hydrated.text).toContain("embed");
    expect(hydrated.tokensSaved).toBeGreaterThan(0);
    expect(dehydrated.record.tokensSaved).toBeGreaterThan(0);
  });

  it("labels hydrate as lossy when the TTL has expired", () => {
    const record = {
      runId: 1,
      stateId: "SF1",
      key: "run:1:cp:0",
      summary: "old",
      historyJson: JSON.stringify([msg("S1", "secret-history")]),
      tokensSaved: 10,
      createdAt: new Date(0),
      expiresAt: new Date(1),
    };
    const result = hydrate({
      record,
      nextSchemas: [],
      now: new Date(1_000),
    });
    expect(result.lossy).toBe(true);
    expect(result.storedHistory).toBeNull();
    expect(result.text).toMatch(/lossy: summary-only/);
  });
});

describe("runCheckpointBoundary", () => {
  it("dehydrates, swaps schemas, hydrates, and emits ::SYSTEM.HYDRATE", async () => {
    const store = createMemoryCheckpointStore();
    const history = longHistory(10);
    const result = await runCheckpointBoundary({
      runId: 3,
      stateId: "SF1",
      seq: 1,
      history,
      dsl: twoClusterDsl,
      strategy: "template",
      dehydrateClusters: ["ingest"],
      hydrateCluster: "transform",
      store,
    });
    expect(result.emission.signal).toBe("::SYSTEM.HYDRATE");
    expect(result.emission.payload.checkpoint_id).toBe("run:3:cp:1");
    expect(result.emission.payload.tokensSaved).toBeGreaterThan(0);
    expect(result.mask.loaded.map((s) => s.name).sort()).toEqual(
      ["embed", "write_index"].sort()
    );
    expect(result.mask.unloaded.map((s) => s.name).sort()).toEqual(
      ["fetch_pages", "parse_html"].sort()
    );
    expect(result.hydrated.text).toContain("write_index");
    expect(store.rows).toHaveLength(1);
  });

  it("falls back to template on llm failure and still hydrates", async () => {
    const history = longHistory(8);
    const result = await runCheckpointBoundary({
      runId: 4,
      stateId: "SF1",
      seq: 0,
      history,
      dsl: twoClusterDsl,
      strategy: "llm",
      dehydrateClusters: ["ingest"],
      hydrateCluster: "transform",
      llm: async () => {
        throw new Error("timeout");
      },
    });
    expect(result.warning).toMatch(/fell back to template/);
    expect(result.emission.payload.strategy).toBe("template");
    expect(result.record.summary).toBe(
      summarizeTemplate(history.filter((m) => m.stateId === "S1" || m.stateId === "S2"))
    );
  });
});
