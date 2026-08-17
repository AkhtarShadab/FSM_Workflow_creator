import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("memory code book graph shows symbol intent and identity", async ({
  page,
}) => {
  await page.goto("/memory");
  await expect(page.getByTestId("memory-layer-toggle")).toBeVisible();

  await page.getByTestId("memory-layer-code-book").click();
  await expect(page.getByTestId("memory-index-fixture")).toBeVisible();

  const existing = page.getByTestId("book-symbol-node");
  if ((await existing.count()) === 0) {
    await page.getByTestId("memory-index-fixture").click();
    await expect(page.getByTestId("memory-index-status")).toContainText(
      "Indexed"
    );
  }

  const symbol = page.getByTestId("book-symbol-node").first();
  await expect(symbol).toBeVisible();
  await expect(symbol.getByTestId("book-symbol-intent")).not.toHaveText("");
  await expect(symbol.getByTestId("book-symbol-identity")).not.toHaveText("");
});
