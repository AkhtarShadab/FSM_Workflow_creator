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

async function openFreshCanvas(page: Page) {
  const name = `e2e-run-contract-${Date.now()}`;
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

test("SCRIPT inspector: retainContext and deny_all persist after reload", async ({
  page,
}) => {
  await openFreshCanvas(page);

  await page
    .locator("button")
    .filter({ has: page.locator("span", { hasText: /^Script$/ }) })
    .first()
    .click();

  await expect(page.getByText("Execution Script")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("tools-card")).toBeVisible();
  await expect(page.getByTestId("context-card")).toBeVisible();

  await page.getByTestId("tool-access-mode").click();
  await page.getByRole("option", { name: /deny_all/ }).click();
  await page.getByTestId("retain-context").click();

  await page.reload();
  await page.waitForURL(/\/canvas/, { timeout: 30_000 });
  await dismissDescribeOverlay(page);
  await expect(page.getByText("Add state")).toBeVisible({ timeout: 30_000 });

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "SCRIPT" })
    .first()
    .click();

  await expect(page.getByTestId("tools-card")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("tool-access-mode")).toContainText("deny_all");
  await expect(page.getByTestId("retain-context")).toBeChecked();
});
