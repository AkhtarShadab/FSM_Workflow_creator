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

test("START → SCRIPT → END run shows engine events", async ({ page }) => {
  const name = `e2e-run-${Date.now()}`;
  await page.goto("/");
  await page.getByText("New Harness").click();
  await page.getByPlaceholder("ingest-and-summarize").fill(name);
  await page.getByText("Create & open canvas").click();
  await page.waitForURL(/\/project\/\d+/, { timeout: 30_000 });
  const projectUrl = page.url().replace(/\/$/, "");

  await page.goto(`${projectUrl}/canvas`);
  await dismissDescribeOverlay(page);

  await page
    .locator("button")
    .filter({ has: page.locator("span", { hasText: /^Start$/ }) })
    .first()
    .click();
  await page
    .locator("button")
    .filter({ has: page.locator("span", { hasText: /^Script$/ }) })
    .first()
    .click();
  await page
    .locator("button")
    .filter({ has: page.locator("span", { hasText: /^End$/ }) })
    .first()
    .click();

  // Connect via preferred signal is hard in E2E — seed edges through reload store is complex.
  // Instead hit the runs API directly after constructing canvas in page.evaluate.
  const result = await page.evaluate(async (pid) => {
    const storeKey = Object.keys(localStorage).find((k) =>
      k.includes("canvas")
    );
    // Build minimal canvas payload
    const canvas = {
      nodes: [
        {
          id: "S0",
          type: "stateCircle",
          position: { x: 0, y: 0 },
          data: {
            stateType: "START",
            label: "Start",
            description: "",
            inputSchema: "",
            outputSchema: "",
            verify: { kind: "schema" },
            onError: { signal: "::SCRIPT.ERROR" },
            script: { toolName: "t", language: "python", code: "" },
            ai: {
              credentialId: "",
              model: "x",
              temperature: 0,
              maxTokens: 1,
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
            guardrails: { timeoutMs: 5000, retryMax: 0, retryBackoffMs: 0 },
            spawn: {
              mode: "homogeneous",
              count: 1,
              maxConcurrency: 1,
              strategy: "waitAll",
              cancelOnParentHalt: true,
              profiles: [
                { id: "default", childFsm: "c", toolPack: [], skillPack: [] },
              ],
              aggregateTo: "",
            },
            systemFunction: {
              summaryStrategy: "template",
              enabledStateIds: [],
              disabledStateIds: [],
              rewire: [],
              heads: [],
            },
          },
        },
        {
          id: "SC1",
          type: "stateCircle",
          position: { x: 100, y: 0 },
          data: {
            stateType: "SCRIPT",
            label: "Script",
            description: "",
            inputSchema: "",
            outputSchema: "",
            verify: { kind: "schema" },
            onError: { signal: "::SCRIPT.ERROR" },
            script: {
              toolName: "t",
              language: "python",
              code: "def run(): pass",
            },
            ai: {
              credentialId: "",
              model: "x",
              temperature: 0,
              maxTokens: 1,
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
            guardrails: { timeoutMs: 5000, retryMax: 0, retryBackoffMs: 0 },
            spawn: {
              mode: "homogeneous",
              count: 3,
              maxConcurrency: 2,
              strategy: "waitAll",
              cancelOnParentHalt: true,
              profiles: [
                { id: "default", childFsm: "c", toolPack: [], skillPack: [] },
              ],
              aggregateTo: "AGG",
            },
            systemFunction: {
              summaryStrategy: "template",
              enabledStateIds: [],
              disabledStateIds: [],
              rewire: [],
              heads: [],
            },
          },
        },
        {
          id: "END",
          type: "stateCircle",
          position: { x: 200, y: 0 },
          data: {
            stateType: "END",
            label: "End",
            description: "",
            inputSchema: "",
            outputSchema: "",
            verify: { kind: "schema" },
            onError: { signal: "::SCRIPT.ERROR" },
            script: { toolName: "t", language: "python", code: "" },
            ai: {
              credentialId: "",
              model: "x",
              temperature: 0,
              maxTokens: 1,
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
            guardrails: { timeoutMs: 5000, retryMax: 0, retryBackoffMs: 0 },
            spawn: {
              mode: "homogeneous",
              count: 1,
              maxConcurrency: 1,
              strategy: "waitAll",
              cancelOnParentHalt: true,
              profiles: [
                { id: "default", childFsm: "c", toolPack: [], skillPack: [] },
              ],
              aggregateTo: "",
            },
            systemFunction: {
              summaryStrategy: "template",
              enabledStateIds: [],
              disabledStateIds: [],
              rewire: [],
              heads: [],
            },
          },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "S0",
          target: "SC1",
          type: "script",
          data: { signal: "::SCRIPT.NEXT" },
        },
        {
          id: "e2",
          source: "SC1",
          target: "END",
          type: "script",
          data: { signal: "::SCRIPT.NEXT" },
        },
      ],
    };
    void storeKey;
    const res = await fetch(`/api/projects/${pid}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canvas }),
    });
    return res.json();
  }, projectUrl.split("/").pop());

  expect(result.status).toBe("succeeded");
  expect(result.events?.length).toBeGreaterThan(0);
  expect(result.events.some((e: { stateId: string }) => e.stateId === "END")).toBe(
    true
  );
});
