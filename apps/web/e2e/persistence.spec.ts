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

test("adding a state autosaves and shows Saved", async ({ page }) => {
  const name = `e2e-persist-${Date.now()}`;
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

  await page
    .locator("button")
    .filter({ has: page.locator("span", { hasText: /^Start$/ }) })
    .first()
    .click();

  await expect(page.getByTestId("sync-badge")).toHaveText("Saved", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("publish-button")).toBeVisible();
});

async function addPaletteState(page: Page, label: RegExp) {
  await page
    .locator("button")
    .filter({ has: page.locator("span", { hasText: label }) })
    .first()
    .click();
}

async function openCanvas(page: Page) {
  const name = `e2e-persist-${Date.now()}`;
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
}

test("publish twice without edits shows one version; restore copies it into draft", async ({
  page,
}) => {
  await openCanvas(page);
  await addPaletteState(page, /^Start$/);
  await expect(page.getByTestId("sync-badge")).toHaveText("Saved", {
    timeout: 15_000,
  });

  const publish = page.getByTestId("publish-button");
  await publish.click();
  await expect(publish).toContainText("1", { timeout: 15_000 });
  await publish.click();
  await expect(publish).toContainText("1");

  await page.getByTestId("version-history-button").click();
  const rows = page.getByTestId("version-row");
  await expect(rows).toHaveCount(1);
  const firstHash = await rows.first().getByTestId("version-hash").getAttribute("title");
  expect(firstHash).toBeTruthy();
  await expect(rows.first().getByTestId("version-created-at")).not.toBeEmpty();
  await page.keyboard.press("Escape");

  await addPaletteState(page, /^End$/);
  await expect(page.getByTestId("sync-badge")).toHaveText("Saved", {
    timeout: 15_000,
  });
  await publish.click();
  await expect(publish).toContainText("2", { timeout: 15_000 });

  await page.getByTestId("version-history-button").click();
  await expect(rows).toHaveCount(2);
  const hashes = await rows.locator("[data-testid=version-hash]").evaluateAll((els) =>
    els.map((el) => el.getAttribute("title") ?? "")
  );
  expect(new Set(hashes).size).toBe(2);

  await rows
    .filter({ hasText: "v1" })
    .getByTestId("restore-version-button")
    .click();
  await expect(page.getByTestId("sync-badge")).toHaveText("Saved", {
    timeout: 15_000,
  });
  await expect(publish).toContainText("2");
});

test("run a published version lists history with status and version", async ({
  page,
}) => {
  await openCanvas(page);
  await addPaletteState(page, /^Start$/);
  await expect(page.getByTestId("sync-badge")).toHaveText("Saved", {
    timeout: 15_000,
  });
  const publish = page.getByTestId("publish-button");
  await publish.click();
  await expect(publish).toContainText("1", { timeout: 15_000 });

  const projectUrl = page.url().replace(/\/canvas\/?$/, "").replace(/\/$/, "");
  await page.goto(`${projectUrl}/runs`);
  await expect(page.getByText("Run history")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("run_001")).toHaveCount(0);
  await expect(page.getByText("Recent local samples")).toHaveCount(0);

  const result = await page.evaluate(async (pid) => {
    const canvas = {
      nodes: [
        {
          id: "S0",
          type: "stateCircle",
          position: { x: 0, y: 0 },
          data: {
            stateType: "START",
            label: "Start",
            onError: { signal: "::SCRIPT.ERROR" },
          },
        },
        {
          id: "E0",
          type: "stateCircle",
          position: { x: 200, y: 0 },
          data: {
            stateType: "END",
            label: "End",
            onError: { signal: "::SCRIPT.ERROR" },
          },
        },
      ],
      edges: [
        {
          id: "e0",
          source: "S0",
          target: "E0",
          type: "script",
          data: { signal: "::SCRIPT.NEXT" },
        },
      ],
    };
    const res = await fetch(`/api/projects/${pid}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canvas }),
    });
    return res.json();
  }, projectUrl.split("/").pop());

  expect(result.status).toBe("succeeded");
  expect(result.runId).toBeTruthy();

  await page.reload();
  const historyRow = page.getByTestId("run-history-row");
  await expect(historyRow).toHaveCount(1, { timeout: 15_000 });
  await expect(historyRow).toHaveAttribute("data-status", "succeeded");
  await expect(historyRow.getByTestId("run-history-version")).toHaveText("v1");
  await expect(page.getByText("run_001")).toHaveCount(0);

  await historyRow.click();
  await expect(page.getByTestId("run-history-event").first()).toBeVisible({
    timeout: 10_000,
  });
});
