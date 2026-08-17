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

async function openScriptInspector(page: Page) {
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "SCRIPT" })
    .first()
    .click();
  await expect(page.getByTestId("guardrails-card")).toBeVisible({
    timeout: 15_000,
  });
}

test("SCRIPT inspector: retryOn chip and retainContext persist after reload", async ({
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
  await expect(page.getByTestId("guardrails-card")).toBeVisible();
  await expect(page.getByTestId("retry-on-helper")).toContainText(
    "retries ≠ self-loop"
  );
  await expect(page.getByTestId("context-card")).toBeVisible();
  await expect(page.getByTestId("tools-card")).toBeVisible();

  const verifyFail = page.getByTestId("retry-on-verify_fail");
  await verifyFail.scrollIntoViewIfNeeded();
  await expect(verifyFail).toHaveAttribute("aria-pressed", "false");
  await verifyFail.click();
  await expect(verifyFail).toHaveAttribute("aria-pressed", "true");

  const retain = page.getByTestId("retain-context");
  await retain.scrollIntoViewIfNeeded();
  await retain.click();
  await expect(retain).toHaveAttribute("aria-checked", "true");

  await page.getByTestId("tool-access-mode").click();
  await page.getByRole("option", { name: /deny_all/ }).click();

  await page.reload();
  await page.waitForURL(/\/canvas/, { timeout: 30_000 });
  await dismissDescribeOverlay(page);
  await expect(page.getByText("Add state")).toBeVisible({ timeout: 30_000 });

  await openScriptInspector(page);

  await expect(page.getByTestId("retry-on-verify_fail")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("retain-context")).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(page.getByTestId("tool-access-mode")).toContainText("deny_all");
});
