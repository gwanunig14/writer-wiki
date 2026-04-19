import { expect, test } from "@playwright/test";

test("export the project and repair sync from settings", async ({ page }) => {
  await page.goto("/setup");

  await page.getByLabel("Project name").fill("Atlas Draft");
  await page.getByLabel("API key").fill("ack-demo-local");
  await page.getByRole("button", { name: "Create project" }).click();

  await page.goto("/settings");
  await page.getByRole("button", { name: "Export zip" }).click();
  await expect(
    page.getByText("Export created:", { exact: false }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Repair sync" }).click();
  await expect(
    page.getByText("Sync repair completed.", { exact: false }),
  ).toBeVisible();
});
