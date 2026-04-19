import { expect, test } from "@playwright/test";

test("onboarding, save, and scan a chapter", async ({ page }) => {
  await page.goto("/setup");

  await page.getByLabel("Project name").fill("Atlas Draft");
  await page.getByLabel("API key").fill("ack-demo-local");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/\/chapters$/);

  await page.getByLabel("Chapter number").fill("1");
  await page.getByLabel("Title").fill("Arrival");
  await page
    .getByLabel("Chapter text")
    .fill("Alice arrives in Harbor City and meets Bob.");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("saved", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Scan" }).click();
  await expect(page.getByText("Scan status")).toBeVisible();
  await expect(page.getByText("success", { exact: false })).toBeVisible({
    timeout: 10000,
  });
});
