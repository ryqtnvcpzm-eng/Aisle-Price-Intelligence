import { expect, test } from "@playwright/test";

test("mobile tab bar and More sheet work", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Explore the demo workspace/ }).click();
  await expect(page.getByRole("heading", { name: "Your market, in focus." })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary" }).last();
  await nav.getByRole("link", { name: "Products" }).click();
  await expect(page).toHaveURL(/\/products/);
  await nav.getByRole("button", { name: "More sections" }).click();
  await page.getByRole("dialog", { name: "More sections" }).getByRole("link", { name: "Insights" }).click();
  await expect(page).toHaveURL(/\/insights/);
});
