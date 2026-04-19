import { expect, test } from "@playwright/test";

test("answer canon questions and refuse brainstorming", async ({ page }) => {
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

  await page.getByRole("button", { name: "Open canon chat" }).click();
  await page
    .getByPlaceholder("Ask a canon question...")
    .fill("Who arrives in Harbor City?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("Canon")).toBeVisible();

  await page
    .getByPlaceholder("Ask a canon question...")
    .fill("Brainstorm a new villain for this story.");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("brainstorming", { exact: false })).toBeVisible();
});
