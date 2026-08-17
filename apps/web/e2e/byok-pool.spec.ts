import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("multi-BYOK discovery and AI model union", async ({ page }) => {
  await page.route("**/api/credentials/discover", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["credentialId"]);
    expect(body).not.toHaveProperty("apiKey");
    const card = page.getByTestId(`credential-card-${body.credentialId}`);
    const text = await card.innerText();
    const models = text.includes("openai-compatible")
      ? ["llama-3"]
      : ["gpt-4o", "gpt-4o-mini"];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        credentialId: body.credentialId,
        models,
        discoveredAt: Date.now(),
      }),
    });
  });

  await page.goto("/settings/credentials");
  await expect(page.getByText("BYOK Credentials")).toBeVisible();

  // Add first key
  await page.getByPlaceholder("Personal OpenAI").fill("Key One");
  await page.getByPlaceholder("sk-…").fill("sk-one-long-secret-value");
  await page.getByText("Save credential").click();
  await expect(page.getByTestId("credential-list")).toContainText("Key One", {
    timeout: 15_000,
  });

  // Add second key (openai-compatible)
  await page.getByPlaceholder("Personal OpenAI").fill("Key Two");
  // change provider via select — click trigger then option
  await page.locator('[data-slot="select-trigger"]').first().click();
  await page.getByText("OpenAI-compatible proxy").click();
  await page.getByPlaceholder("sk-…").fill("sk-two-long-secret-value");
  await page.getByText("Save credential").click();

  const cards = page
    .getByTestId("credential-list")
    .locator("[data-testid^=credential-card-]");
  await expect(cards).toHaveCount(2, { timeout: 15_000 });

  // Discover both
  const discoverBtns = page.locator("[data-testid^=discover-]");
  await discoverBtns.nth(0).click();
  await discoverBtns.nth(1).click();

  await expect(page.locator("text=gpt-4o").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator("text=llama-3").first()).toBeVisible({
    timeout: 10_000,
  });
});
