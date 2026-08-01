import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

async function dismissDescribeOverlay(page: Page) {
  const describeField = page.getByPlaceholder(/Scrape 12 pages/);
  try {
    await describeField.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    return;
  }
  // Close via the panel X (first button in the z-30 overlay)
  await page.locator("div.absolute.inset-0.z-30 button").first().click();
  await expect(describeField).toBeHidden({ timeout: 10_000 });
}

/**
 * C1 happy path: create project → open canvas → add SPAWN → set concurrency → reload persists.
 */
test("SPAWN inspector concurrency persists after reload", async ({ page }) => {
  const name = `e2e-spawn-${Date.now()}`;
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
    .filter({ has: page.locator("span", { hasText: /^Spawn$/ }) })
    .first()
    .click();

  await expect(page.getByText("Subagent Fan-Out")).toBeVisible({
    timeout: 15_000,
  });

  const maxConcurrency = page.getByLabel("Max concurrency");
  await maxConcurrency.fill("4");
  await expect(maxConcurrency).toHaveValue("4");
  await expect(page.locator("text=/max 4/i").first()).toBeVisible({
    timeout: 5_000,
  });

  await page.reload();
  await page.waitForURL(/\/canvas/, { timeout: 30_000 });
  await dismissDescribeOverlay(page);
  await expect(page.getByText("Add state")).toBeVisible({ timeout: 30_000 });

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "SPAWN" })
    .first()
    .click();
  await expect(page.getByText("Subagent Fan-Out")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByLabel("Max concurrency")).toHaveValue("4");
});
