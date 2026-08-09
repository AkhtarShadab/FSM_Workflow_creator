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
  const name = `e2e-sysfunc-${Date.now()}`;
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

function addState(page: Page, label: string) {
  return page
    .locator("button")
    .filter({ has: page.locator("span", { hasText: new RegExp(`^${label}$`) }) })
    .first()
    .click();
}

test("SYS_FUNC disable dims target and rewire persists after reload", async ({
  page,
}) => {
  await openFreshCanvas(page);

  await addState(page, "Script");
  await expect(page.getByText("Execution Script")).toBeVisible({
    timeout: 15_000,
  });

  await addState(page, "Sys Func");
  await expect(page.getByText("Checkpoint Boundary")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Enable map")).toBeVisible();

  const scriptNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "SCRIPT" })
    .first();
  const scriptId = await scriptNode.getAttribute("data-id");
  expect(scriptId).toBeTruthy();

  const disableToggle = page.getByTestId(`sysfunc-disabled-${scriptId}`);
  await disableToggle.locator('button[role="switch"]').click();

  await expect(scriptNode.locator("[data-dimmed=true]")).toBeVisible({
    timeout: 5_000,
  });

  await page.getByTestId("sysfunc-rewire-add").click();
  await expect(page.getByTestId("sysfunc-rewire-table")).toBeVisible();

  await page.reload();
  await page.waitForURL(/\/canvas/, { timeout: 30_000 });
  await dismissDescribeOverlay(page);

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "SYSTEM_FUNCTION" })
    .first()
    .click();
  await expect(page.getByText("Enable map")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("sysfunc-rewire-table")).toBeVisible();
  const disableSwitch = page
    .getByTestId(`sysfunc-disabled-${scriptId}`)
    .locator('button[role="switch"]');
  await expect(disableSwitch).toHaveAttribute("aria-checked", "true", {
    timeout: 5_000,
  });
});

test("mask with no path to END shows lint error badge", async ({ page }) => {
  await openFreshCanvas(page);

  await addState(page, "End");
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "END" })
  ).toHaveCount(1, { timeout: 10_000 });

  await addState(page, "Sys Func");
  await expect(page.getByText("Enable map")).toBeVisible({ timeout: 15_000 });

  const endNode = page
    .locator(".react-flow__node")
    .filter({ hasText: /^END/ })
    .first();
  const endId = await endNode.getAttribute("data-id");
  expect(endId).toBeTruthy();

  await page
    .getByTestId(`sysfunc-disabled-${endId}`)
    .locator('button[role="switch"]')
    .click();

  const lintPanel = page.getByTestId("canvas-lint-panel");
  await expect(lintPanel).toBeVisible({ timeout: 10_000 });
  await lintPanel.getByRole("button").first().click();
  await expect(page.getByTestId("lint-issue-MASK_NO_PATH_TO_END")).toBeVisible({
    timeout: 5_000,
  });
});
