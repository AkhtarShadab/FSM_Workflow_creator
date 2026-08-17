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
  const name = `e2e-f1-palette-${Date.now()}`;
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

test("canvas toolbar shows segregated palette groups (F1)", async ({ page }) => {
  await openFreshCanvas(page);

  await expect(page.getByTestId("palette-groups")).toBeVisible();
  await expect(page.getByTestId("palette-group-flow")).toBeVisible();
  await expect(page.getByTestId("palette-group-work")).toBeVisible();
  await expect(page.getByTestId("palette-group-generative")).toBeVisible();
  await expect(page.getByTestId("palette-group-control")).toBeVisible();
  await expect(page.getByTestId("palette-group-custom")).toBeVisible();

  await expect(
    page.getByTestId("palette-group-flow").getByText("Flow", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByTestId("palette-group-work").getByText("Work", { exact: true })
  ).toBeVisible();
  await expect(
    page
      .getByTestId("palette-group-generative")
      .getByText("Generative", { exact: true })
  ).toBeVisible();
  await expect(
    page
      .getByTestId("palette-group-control")
      .getByText("Control", { exact: true })
  ).toBeVisible();
});
