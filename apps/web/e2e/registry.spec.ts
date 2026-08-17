import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("registry signal and skill lint", async ({ page }) => {
  await page.goto("/settings/registry");
  await expect(page.getByText("Extension registry")).toBeVisible();

  await page.getByTestId("registry-signal-input").fill("::MYAPP.DONE");
  await page
    .getByTestId("registry-signal-description")
    .fill("Emitted when the custom workflow step completes successfully");
  await page.getByTestId("registry-signal-add").click();
  await expect(page.getByTestId("registry-signal-list")).toContainText(
    "::MYAPP.DONE"
  );

  await page.getByTestId("registry-tab-skills").click();
  await page.getByTestId("registry-skill-input").fill("ship-feature");
  await page.getByTestId("registry-skill-add").click();
  await expect(page.getByTestId("registry-skill-list")).toContainText(
    "ship-feature"
  );
});
