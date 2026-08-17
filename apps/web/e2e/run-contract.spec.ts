import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

async function dismissDescribeOverlay(page: Page) {
  const describeField = page.getByPlaceholder(/Scrape 12 pages/);
  try {
    await describeField.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    return;
  }
  await page.locator("div.absolute.inset-0.z-30 button").first().click();
  await expect(describeField).toBeHidden({ timeout: 10_000 });
}

const baseNodeData = {
  description: "",
  inputSchema: "",
  outputSchema: "",
  verify: { kind: "schema" },
  onError: { signal: "::SCRIPT.ERROR" },
  script: { toolName: "t", language: "python", code: "" },
  ai: {
    credentialId: "",
    model: "mock-chat",
    temperature: 0,
    maxTokens: 64,
    systemPrompt: "",
    outputSchema: "",
  },
  http: {
    method: "GET",
    urlTemplate: "https://example.com",
    headers: {},
    successSignals: ["::HTTP.NEXT"],
  },
  validate: { kind: "schema", schema: '{"type":"object"}' },
  externalAi: {
    credentialId: "",
    credentialKind: "openai_compatible",
    baseUrl: "",
    model: "",
    temperature: 0,
    maxTokens: 1,
    systemPrompt: "",
    outputSchema: "",
  },
  human: { prompt: "", approvalSignals: ["::HUMAN.APPROVE"] },
  guardrails: { timeoutMs: 5000, retryMax: 0, retryBackoffMs: 0 },
  spawn: {
    mode: "homogeneous",
    count: 1,
    maxConcurrency: 1,
    strategy: "waitAll",
    cancelOnParentHalt: true,
    profiles: [{ id: "default", childFsm: "c", toolPack: [], skillPack: [] }],
    aggregateTo: "",
  },
  aggregate: { fromSpawnId: "", strategy: "waitAll" },
  systemFunction: {
    summaryStrategy: "template",
    enabledStateIds: [],
    disabledStateIds: [],
    rewire: [],
    heads: [],
  },
};

const SSE_KINDS = [
  "state.start",
  "state.output",
  "state.retry",
  "state.error",
  "state.transition",
  "run.complete",
  "run.failed",
  "run.cursor",
  "run.resume_without_cursor",
];

async function createProject(page: Page): Promise<{ projectUrl: string; projectId: string }> {
  const name = `e2e-014-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/");
  await page.getByText("New Harness").click();
  await page.getByPlaceholder("ingest-and-summarize").fill(name);
  await page.getByText("Create & open canvas").click();
  await page.waitForURL(/\/project\/\d+/, { timeout: 30_000 });
  const projectUrl = page.url().replace(/\/$/, "");
  const projectId = projectUrl.split("/").pop()!;
  return { projectUrl, projectId };
}

type RunEvent = { kind: string; stateId: string; payload?: unknown };

async function runCanvas(
  page: Page,
  projectId: string,
  canvas: unknown
): Promise<{ httpStatus: number; runId?: number; events: RunEvent[] }> {
  return page.evaluate(
    async ({ pid, canvas: c, kinds }) => {
      const res = await fetch(`/api/projects/${pid}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvas: c }),
      });
      const body = (await res.json()) as { runId?: number; error?: string };
      if (res.status !== 202 || body.runId == null) {
        return { httpStatus: res.status, runId: body.runId, events: [] as RunEvent[] };
      }
      const events = await new Promise<RunEvent[]>((resolve, reject) => {
        const acc: RunEvent[] = [];
        const es = new EventSource(`/api/runs/${body.runId}/stream`);
        const timer = setTimeout(() => {
          es.close();
          reject(new Error("SSE timeout"));
        }, 25_000);
        const onFrame = (kind: string, ev: MessageEvent<string>) => {
          const data = JSON.parse(ev.data) as {
            kind?: string;
            stateId?: string;
            payload?: unknown;
          };
          acc.push({
            kind: data.kind ?? kind,
            stateId: data.stateId ?? "",
            payload: data.payload,
          });
          if (kind === "run.complete" || kind === "run.failed") {
            clearTimeout(timer);
            es.close();
            resolve(acc);
          }
        };
        for (const kind of kinds) {
          es.addEventListener(kind, (ev) =>
            onFrame(kind, ev as MessageEvent<string>)
          );
        }
      });
      return { httpStatus: res.status, runId: body.runId, events };
    },
    { pid: projectId, canvas, kinds: SSE_KINDS }
  );
}

test("HTTP retryMax 1 with mock 500 then 200 emits state.retry then succeeds", async ({
  page,
}) => {
  const { projectId } = await createProject(page);
  await page.goto(`/project/${projectId}/runs`);
  await dismissDescribeOverlay(page);

  const result = await runCanvas(page, projectId, {
    nodes: [
      {
        id: "S0",
        type: "stateCircle",
        position: { x: 0, y: 0 },
        data: { ...baseNodeData, stateType: "START", label: "Start" },
      },
      {
        id: "H1",
        type: "stateCircle",
        position: { x: 200, y: 0 },
        data: {
          ...baseNodeData,
          stateType: "HTTP",
          label: "Http",
          onError: { signal: "::HTTP.ERROR" },
          http: {
            ...baseNodeData.http,
            urlTemplate: "https://example.com/__fsm_mock_http_retry",
          },
          guardrails: { timeoutMs: 5000, retryMax: 1, retryBackoffMs: 0 },
        },
      },
      {
        id: "END",
        type: "stateCircle",
        position: { x: 400, y: 0 },
        data: { ...baseNodeData, stateType: "END", label: "End" },
      },
    ],
    edges: [
      { id: "e1", source: "S0", target: "H1", data: { signal: "::SCRIPT.NEXT" } },
      { id: "e2", source: "H1", target: "END", data: { signal: "::HTTP.NEXT" } },
    ],
  });

  expect(result.httpStatus).toBe(202);
  expect(result.events.some((e) => e.kind === "state.retry")).toBe(true);
  expect(result.events.some((e) => e.kind === "run.complete")).toBe(true);
});

test("empty AI tool allowlist emits TOOL_DENIED and is not a silent success", async ({
  page,
}) => {
  const { projectUrl, projectId } = await createProject(page);
  await page.goto(`${projectUrl}/runs`);
  await dismissDescribeOverlay(page);

  const result = await runCanvas(page, projectId, {
    nodes: [
      {
        id: "S0",
        type: "stateCircle",
        position: { x: 0, y: 0 },
        data: { ...baseNodeData, stateType: "START", label: "Start" },
      },
      {
        id: "AI1",
        type: "stateCircle",
        position: { x: 200, y: 0 },
        data: {
          ...baseNodeData,
          stateType: "AI",
          label: "AI",
          ai: { ...baseNodeData.ai, systemPrompt: "INVOKE_TOOL:search" },
          toolAccess: { mode: "allowlist", allow: [] },
        },
      },
      {
        id: "END",
        type: "stateCircle",
        position: { x: 400, y: 0 },
        data: { ...baseNodeData, stateType: "END", label: "End" },
      },
    ],
    edges: [
      { id: "e1", source: "S0", target: "AI1", data: { signal: "::SCRIPT.NEXT" } },
      { id: "e2", source: "AI1", target: "END", data: { signal: "::AI.NEXT" } },
    ],
  });

  expect(result.httpStatus).toBe(202);
  const denied = result.events.some((e) => {
    const p = e.payload as { signal?: string } | undefined;
    return p?.signal === "::AI.TOOL_DENIED" || e.kind === "tool.denied";
  });
  expect(denied).toBe(true);
  expect(result.events.some((e) => e.kind === "run.complete")).toBe(false);
});

test("two AI states complete a smoke run", async ({ page }) => {
  const { projectId } = await createProject(page);
  await page.goto(`/project/${projectId}/runs`);
  await dismissDescribeOverlay(page);

  const result = await runCanvas(page, projectId, {
    nodes: [
      {
        id: "S0",
        type: "stateCircle",
        position: { x: 0, y: 0 },
        data: { ...baseNodeData, stateType: "START", label: "Start" },
      },
      {
        id: "AI1",
        type: "stateCircle",
        position: { x: 200, y: 0 },
        data: {
          ...baseNodeData,
          stateType: "AI",
          label: "AI1",
          ai: { ...baseNodeData.ai, systemPrompt: "first" },
        },
      },
      {
        id: "AI2",
        type: "stateCircle",
        position: { x: 400, y: 0 },
        data: {
          ...baseNodeData,
          stateType: "AI",
          label: "AI2",
          ai: { ...baseNodeData.ai, systemPrompt: "second" },
        },
      },
      {
        id: "END",
        type: "stateCircle",
        position: { x: 600, y: 0 },
        data: { ...baseNodeData, stateType: "END", label: "End" },
      },
    ],
    edges: [
      { id: "e1", source: "S0", target: "AI1", data: { signal: "::SCRIPT.NEXT" } },
      { id: "e2", source: "AI1", target: "AI2", data: { signal: "::AI.NEXT" } },
      { id: "e3", source: "AI2", target: "END", data: { signal: "::AI.NEXT" } },
    ],
  });

  expect(result.httpStatus).toBe(202);
  expect(result.events.some((e) => e.kind === "run.complete")).toBe(true);
  expect(
    result.events.filter((e) => e.kind === "state.output" && e.stateId.startsWith("AI"))
      .length
  ).toBeGreaterThanOrEqual(2);
});
