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
  const name = `e2e-c4-${Date.now()}`;
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
  return projectUrl;
}

test("palette groups and HTTP URL persist", async ({ page }) => {
  await openFreshCanvas(page);

  await expect(page.getByTestId("palette-groups")).toBeVisible();
  await expect(page.getByTestId("palette-group-flow")).toBeVisible();
  await expect(page.getByTestId("palette-group-work")).toBeVisible();
  await expect(page.getByTestId("palette-group-generative")).toBeVisible();
  await expect(page.getByTestId("palette-group-control")).toBeVisible();

  await page
    .locator("button")
    .filter({ has: page.locator("span", { hasText: /^HTTP$/ }) })
    .first()
    .click();

  await expect(page.getByText("HTTP Request")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("URL template").fill("https://example.com/api");

  await page.reload();
  await page.waitForURL(/\/canvas/, { timeout: 30_000 });
  await dismissDescribeOverlay(page);

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "HTTP" })
    .first()
    .click();
  await expect(page.getByLabel("URL template")).toHaveValue(
    "https://example.com/api"
  );
});

test("VALIDATE empty schema shows lint error", async ({ page }) => {
  await openFreshCanvas(page);

  await page
    .locator("button")
    .filter({ has: page.locator("span", { hasText: /^Validate$/ }) })
    .first()
    .click();
  await expect(page.getByText("Validation")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("JSON Schema").fill("");

  const lintPanel = page.getByTestId("canvas-lint-panel");
  await expect(lintPanel).toBeVisible({ timeout: 10_000 });
  await lintPanel.getByRole("button").first().click();
  await expect(page.getByTestId("lint-issue-VALIDATE_INCOMPLETE")).toBeVisible({
    timeout: 5_000,
  });
});
