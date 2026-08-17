import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";

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

async function createProject(page: Page): Promise<string> {
  const name = `e2e-export-${Date.now()}`;
  await page.goto("/");
  await page.getByText("New Harness").click();
  await expect(page.getByText("Create a new harness")).toBeVisible();
  await page.getByPlaceholder("ingest-and-summarize").fill(name);
  await page.getByText("Create & open canvas").click();
  await page.waitForURL(/\/project\/\d+/, { timeout: 30_000 });
  return page.url().replace(/\/$/, "").replace(/\/canvas\/?$/, "");
}

async function openCanvas(page: Page, projectUrl: string) {
  await page.goto(`${projectUrl}/canvas`);
  await page.waitForURL(/\/canvas/, { timeout: 30_000 });
  await dismissDescribeOverlay(page);
  await expect(page.getByText("Add state")).toBeVisible({ timeout: 30_000 });
}

test("export before publishing is blocked with the publish prompt", async ({
  page,
}) => {
  const projectUrl = await createProject(page);
  await page.goto(`${projectUrl}/export`);
  await expect(page.getByTestId("publish-prompt")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Publish a version first")).toBeVisible();
  await expect(page.getByTestId("open-canvas-link")).toHaveAttribute(
    "href",
    /\/canvas$/
  );
});

test("publish then export ZIP downloads the harness and lists history", async ({
  page,
}) => {
  const projectUrl = await createProject(page);
  await openCanvas(page, projectUrl);
  await page
    .locator("button")
    .filter({ has: page.locator("span", { hasText: /^Start$/ }) })
    .first()
    .click();
  await expect(page.getByTestId("sync-badge")).toHaveText("Saved", {
    timeout: 15_000,
  });
  const publish = page.getByTestId("publish-button");
  await publish.click();
  await expect(publish).toContainText("1", { timeout: 15_000 });

  await page.goto(`${projectUrl}/export`);
  await expect(page.getByTestId("download-zip-button")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("export-version-row")).toHaveCount(1);

  const responsePromise = page.waitForResponse(
    (res) =>
      res.url().includes("/export") &&
      res.request().method() === "POST" &&
      res.status() === 200
  );
  await page.getByTestId("download-zip-button").click();
  const response = await responsePromise;
  expect(response.headers()["content-type"]).toContain("zip");
  const zip = await JSZip.loadAsync(await response.body());
  const names = Object.keys(zip.files);
  expect(names).toEqual(
    expect.arrayContaining(["manifest.json", "fsm.json", "docker-compose.yml"])
  );

  const firstHash = await page.getByTestId("export-job-hash").first().getAttribute("title");
  await expect(page.getByTestId("export-job-row")).toHaveCount(1);
  expect(firstHash).toBeTruthy();

  await page.getByTestId("download-zip-button").click();
  await expect(page.getByTestId("export-job-row")).toHaveCount(2, {
    timeout: 15_000,
  });
  const hashes = await page
    .locator("[data-testid=export-job-hash]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("title") ?? ""));
  expect(hashes[0]).toBe(hashes[1]);
  expect(hashes[0]).toBe(firstHash);
});
