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
