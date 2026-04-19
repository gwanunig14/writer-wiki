import { expect, test } from "@playwright/test";

test("browse generated canon from the sidebar", async ({ page }) => {
  await page.goto("/setup");

  await page.getByLabel("Project name").fill("Atlas Draft");
  await page.getByLabel("API key").fill("ack-demo-local");
  await page.getByRole("button", { name: "Create project" }).click();

  await page.getByLabel("Chapter number").fill("1");
  await page.getByLabel("Title").fill("Arrival");
  await page
    .getByLabel("Chapter text")
    .fill("Alice arrives in Harbor City and meets Bob.");
  await page.getByRole("button", { name: "Scan" }).click();

  await expect(page.getByText("success", { exact: false })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole("link", { name: "Characters" }).click();
  await page.getByRole("link", { name: "Alice (stub)" }).click();
  await expect(page.getByRole("heading", { name: "Alice" })).toBeVisible();
});
