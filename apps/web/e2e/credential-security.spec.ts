import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const SECRET = "sk-this-is-a-very-long-secret-key-value";

test("v2 migrate strips apiKey from legacy localStorage", async ({ page }) => {
  await page.addInitScript((secret) => {
    localStorage.setItem(
      "fsm-credential-store",
      JSON.stringify({
        state: {
          credentials: [
            {
              id: "cred_old",
              label: "Legacy",
              provider: "openai",
              baseUrl: "https://api.openai.com",
              apiKey: secret,
              models: [],
              active: true,
              discoveryStatus: "idle",
            },
          ],
          activeId: "cred_old",
        },
        version: 1,
      })
    );
  }, SECRET);

  await page.goto("/settings/credentials");
  await expect(page.getByText("BYOK Credentials")).toBeVisible();
  await expect(page.getByTestId("credential-reentry-banner")).toBeVisible();

  const snapshot = await page.evaluate(
    () => localStorage.getItem("fsm-credential-store") ?? ""
  );
  expect(snapshot).not.toContain(SECRET);
  expect(snapshot).not.toMatch(/"apiKey"/);
  expect(snapshot).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
});

test("add credential does not persist the secret in localStorage", async ({
  page,
}) => {
  await page.route("**/api/credentials/discover", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["credentialId"]);
    expect(body).not.toHaveProperty("apiKey");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        credentialId: body.credentialId,
        models: ["gpt-4o"],
        discoveredAt: Date.now(),
      }),
    });
  });

  await page.goto("/settings/credentials");
  await expect(page.getByText("BYOK Credentials")).toBeVisible();
  await expect(
    page.getByText("Keys are stored encrypted on the server")
  ).toBeVisible();

  await page.getByPlaceholder("Personal OpenAI").fill("Playwright Key");
  await page.getByPlaceholder("sk-…").fill(SECRET);
  await page.getByText("Save credential").click();

  const last4 = SECRET.slice(-4);
  await expect(page.getByTestId("credential-list")).toContainText(
    `•••• ${last4}`,
    { timeout: 15_000 }
  );

  const snapshot = await page.evaluate(
    () => localStorage.getItem("fsm-credential-store") ?? ""
  );
  expect(snapshot).not.toContain(SECRET);
  expect(snapshot).not.toMatch(/"apiKey"/);
  expect(snapshot).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);

  await page.reload();
  await expect(page.getByTestId("credential-list")).toContainText(
    `•••• ${last4}`
  );

  await page.locator("[data-testid^=discover-]").first().click();
  await expect(page.locator("text=gpt-4o").first()).toBeVisible({
    timeout: 10_000,
  });
});
