import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("multi-BYOK discovery and AI model union", async ({ page }) => {
  await page.route("**/api/credentials/discover", async (route) => {
    const body = route.request().postDataJSON() as { id?: string; provider?: string };
    if (body.provider === "anthropic") {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "boom", id: body.id }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        id: body.id,
        models: body.provider === "openai" ? ["gpt-4o", "gpt-4o-mini"] : ["llama-3"],
        discoveredAt: Date.now(),
      }),
    });
  });

  await page.goto("/settings/credentials");
  await expect(page.getByText("BYOK Credentials")).toBeVisible();

  // Add first key
  await page.getByPlaceholder("Personal OpenAI").fill("Key One");
  await page.getByPlaceholder("sk-…").fill("sk-one");
  await page.getByText("Save credential").click();

  // Add second key (openai-compatible)
  await page.getByPlaceholder("Personal OpenAI").fill("Key Two");
  // change provider via select — click trigger then option
  await page.locator('[data-slot="select-trigger"]').first().click();
  await page.getByText("OpenAI-compatible proxy").click();
  await page.getByPlaceholder("sk-…").fill("sk-two");
  await page.getByText("Save credential").click();

  const cards = page.getByTestId("credential-list").locator("[data-testid^=credential-card-]");
  await expect(cards).toHaveCount(2);

  // Discover both
  const discoverBtns = page.locator("[data-testid^=discover-]");
  await discoverBtns.nth(0).click();
  await discoverBtns.nth(1).click();

  await expect(page.locator("text=gpt-4o").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("text=llama-3").first()).toBeVisible({ timeout: 10_000 });
});
