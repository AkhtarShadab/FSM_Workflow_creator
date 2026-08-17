import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("code index: workspace path yields symbols table", async ({ page }) => {
  await page.goto("/code-index");
  await expect(page.getByText("Code Index")).toBeVisible();

  await page.getByTestId("code-index-path").fill(
    "apps/web/fixtures/code-index-sample"
  );
  await page.getByTestId("code-index-run").click();

  await expect(page.getByTestId("code-index-status")).toContainText("Indexed");
  const results = page.getByTestId("code-index-results");
  await expect(results).toContainText("sample.ts");
  await expect(results).toContainText("greet");
  await expect(results).toContainText("function");
});
