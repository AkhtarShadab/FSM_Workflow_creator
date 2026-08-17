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

async function createDummyHarness(page: Page) {
  const name = `dummy-workflow-${Date.now()}`;
  await page.goto("/");
  await page.getByText("New Harness").click();
  await expect(page.getByText("Create a new harness")).toBeVisible();
  await page.getByPlaceholder("ingest-and-summarize").fill(name);
  await page.getByText("Create & open canvas").click();
  await page.waitForURL(/\/project\/\d+/, { timeout: 30_000 });
  const projectUrl = page.url().replace(/\/$/, "");
  await page.goto(`${projectUrl}/canvas`);
  await page.waitForURL(/\/canvas/, { timeout: 30_000 });
  await dismissDescribeOverlay(page);
  await expect(page.getByText("Add state")).toBeVisible({ timeout: 30_000 });
  return { name, projectUrl, projectId: projectUrl.split("/").pop() as string };
}

async function addPaletteState(page: Page, type: string) {
  const byTestId = page.getByTestId(`palette-add-${type}`);
  if ((await byTestId.count()) > 0) {
    await byTestId.first().click();
    return;
  }
  const labels: Record<string, string> = {
    START: "Start",
    HTTP: "HTTP",
    END: "End",
    SCRIPT: "Script",
    VALIDATE: "Validate",
  };
  await page
    .locator("button")
    .filter({ has: page.locator("span", { hasText: new RegExp(`^${labels[type] ?? type}$`) }) })
    .first()
    .click();
}

test("dummy START → HTTP → END workflow authors, persists, and runs", async ({
  page,
}) => {
  const { projectUrl, projectId } = await createDummyHarness(page);

  await addPaletteState(page, "START");
  await addPaletteState(page, "HTTP");
  await addPaletteState(page, "END");

  await expect(page.getByTestId("state-node-START")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("state-node-HTTP")).toBeVisible();
  await expect(page.getByTestId("state-node-END")).toBeVisible();

  await page.getByTestId("state-node-HTTP").click();
  const urlField = page.getByLabel("URL template");
  await expect(urlField).toBeVisible({ timeout: 15_000 });
  await urlField.fill("https://example.com/health");

  await page.reload();
  await page.waitForURL(/\/canvas/, { timeout: 30_000 });
  await dismissDescribeOverlay(page);

  await expect(page.getByTestId("state-node-START")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("state-node-HTTP")).toBeVisible();
  await expect(page.getByTestId("state-node-END")).toBeVisible();
  await page.getByTestId("state-node-HTTP").click();
  await expect(page.getByLabel("URL template")).toHaveValue(
    "https://example.com/health"
  );

  const result = await page.evaluate(async (pid) => {
    const raw = localStorage.getItem("fsm-canvas-store");
    if (!raw) return { error: "missing fsm-canvas-store" };
    const parsed = JSON.parse(raw) as {
      state?: { canvases?: Record<string, { nodes: Array<{ id: string; data: { stateType: string } }>; edges: unknown[] }> };
    };
    const canvas = parsed.state?.canvases?.[pid];
    if (!canvas?.nodes?.length) return { error: "canvas empty", pid };
    const start = canvas.nodes.find((n) => n.data.stateType === "START");
    const http = canvas.nodes.find((n) => n.data.stateType === "HTTP");
    const end = canvas.nodes.find((n) => n.data.stateType === "END");
    if (!start || !http || !end) {
      return { error: "missing START/HTTP/END", types: canvas.nodes.map((n) => n.data.stateType) };
    }
    const wired = {
      ...canvas,
      edges: [
        {
          id: "e-start-http",
          source: start.id,
          target: http.id,
          type: "script",
          data: { signal: "::SCRIPT.NEXT", kind: "transition" },
        },
        {
          id: "e-http-end",
          source: http.id,
          target: end.id,
          type: "script",
          data: { signal: "::HTTP.NEXT", kind: "transition" },
        },
      ],
    };
    const res = await fetch(`/api/projects/${pid}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canvas: wired }),
    });
    const body = await res.json();
    return { httpStatus: res.status, ...body };
  }, projectId);

  expect(result, JSON.stringify(result)).toMatchObject({ status: "succeeded" });
  expect(Array.isArray(result.events) ? result.events.length : 0).toBeGreaterThan(
    0
  );
  expect(
    (result.events as Array<{ stateId: string }>).some((e) =>
      String(e.stateId).length > 0
    )
  ).toBe(true);

  await page.goto(`${projectUrl}/runs`);
  await expect(page.getByText(/run|event|succeeded|dummy/i).first()).toBeVisible({
    timeout: 20_000,
  });
});

test("dummy harness memory code book still loads", async ({ page }) => {
  await page.goto("/memory");
  const toggle = page.getByTestId("memory-layer-toggle");
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("memory-layer-code-book").click();
  await expect(page.getByTestId("memory-index-fixture")).toBeVisible();
});
