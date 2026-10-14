import { expect, test, type Page } from "@playwright/test";

/** Nothing may be wider than the phone: horizontal overflow widens the layout viewport and pushes the fixed tab bar off-screen. */
async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth, `page is ${scrollWidth}px wide on a ${clientWidth}px screen`).toBeLessThanOrEqual(clientWidth);
}

test("mobile tab bar, More sheet, and no horizontal overflow", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Explore the demo workspace/ }).click();
  await expect(page.getByRole("heading", { name: "Your market, in focus." })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const nav = page.getByRole("navigation", { name: "Primary" }).last();
  await nav.getByRole("link", { name: "Products" }).click();
  await expect(page).toHaveURL(/\/products/);
  await nav.getByRole("button", { name: "More sections" }).click();
  await page.getByRole("dialog", { name: "More sections" }).getByRole("link", { name: "Insights" }).click();
  await expect(page).toHaveURL(/\/insights/);

  // Same session (sign-ins are rate-limited): no screen may be wider than the phone.
  for (const path of ["/products", "/comparisons", "/history", "/brands", "/insights", "/alerts", "/reports", "/activity", "/settings"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expectNoHorizontalOverflow(page);
  }
});
