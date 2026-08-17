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
  const name = `e2e-f2-catalog-${Date.now()}`;
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

test("registry adds ::MYAPP.DONE with description (F2)", async ({ page }) => {
  await page.goto("/settings/registry");
  await expect(page.getByText("Extension registry")).toBeVisible();
  await expect(page.getByTestId("registry-tab-signals")).toBeVisible();

  await page.getByTestId("registry-signal-input").fill("::MYAPP.DONE");
  await page
    .getByTestId("registry-signal-description")
    .fill("Emitted when the custom workflow step completes successfully");
  await page.getByTestId("registry-signal-add").click();
  await expect(page.getByTestId("registry-signal-list")).toContainText(
    "::MYAPP.DONE"
  );
  await expect(page.getByTestId("registry-signal-list")).toContainText(
    "Emitted when the custom workflow step completes successfully"
  );
});

test("custom state Review Gate appears under Custom palette (F2)", async ({
  page,
}) => {
  await page.goto("/settings/registry");
  await expect(page.getByText("Extension registry")).toBeVisible();
  await page.getByTestId("registry-tab-states").click();

  await page.getByTestId("registry-state-id").fill("review-gate");
  await page.getByTestId("registry-state-label").fill("Review Gate");
  await page.getByTestId("registry-state-executor").click();
  await page.getByRole("option", { name: /none \(VALIDATE-like\)/ }).click();
  await page
    .getByTestId("registry-state-signals")
    .fill("::MYAPP.DONE, ::MYAPP.FAIL");
  await page
    .getByTestId("registry-state-description")
    .fill("Human review gate before continuing the workflow");
  await page.getByTestId("registry-state-add").click();
  await expect(page.getByTestId("registry-state-list")).toContainText(
    "Review Gate"
  );

  await openFreshCanvas(page);
  await expect(page.getByTestId("palette-group-custom")).toBeVisible();
  await expect(page.getByTestId("palette-custom-review-gate")).toBeVisible();
  await expect(page.getByTestId("palette-custom-review-gate")).toContainText(
    "Review Gate"
  );
});
