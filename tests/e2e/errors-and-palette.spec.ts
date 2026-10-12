import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Explore the demo workspace/ }).click();
  await expect(page).toHaveURL((u) => !u.pathname.startsWith("/sign-in"));
});

test("invalid and unsupported links are explained, not silently ignored", async ({ page }) => {
  await page.keyboard.press("n");
  const input = page.getByLabel("Amazon product links or ASINs");
  await input.fill("https://www.example.com/dp/B0AISLE002");
  await expect(page.getByText(/Only Amazon product links can be imported/)).toBeVisible();
  await input.fill("https://www.amazon.in/s?k=protein");
  await expect(page.getByText(/doesn't point to a single product page/)).toBeVisible();
  await input.fill("B0AISLE001\nhttps://www.amazon.in/dp/B0AISLE001");
  await expect(page.getByText("Duplicate — same listing")).toBeVisible();
});

test("command palette navigates with the keyboard", async ({ page }) => {
  await page.keyboard.press("Control+k");
  const box = page.getByPlaceholder(/Search products, brands/);
  await expect(box).toBeFocused();
  await box.fill("Comparisons");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/comparisons$/);
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Search products, brands/).fill("Northfield");
  await expect(page.getByRole("option", { name: /Northfield Labs/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder(/Search products, brands/)).toHaveCount(0);
});

test("sidebar collapses and expands without reloading", async ({ page }) => {
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
});
