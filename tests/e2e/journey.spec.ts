import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The brief's end-to-end journey with a brand-new account in demo mode:
 * onboarding → Amazon India → import a product + competitor (variants) →
 * comparison → normalized prices → history → alert → refresh → export.
 */
test.describe.configure({ mode: "serial" });

const email = `e2e-${Date.now()}@aisle.test`;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
});

test("sign up and land in onboarding", async () => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("E2E Analyst");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.getByRole("heading", { name: "Welcome to Aisle" })).toBeVisible();
});

test("choose Amazon India and import a product with its variants", async () => {
  await page.getByRole("button", { name: /Get started/ }).click();
  await page.getByRole("button", { name: /amazon\.in/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Paste an Amazon link/ }).click();
  const input = page.getByLabel("Amazon product links or ASINs");
  await expect(input).toBeFocused();
  await input.fill("https://www.amazon.in/Lumen-Plant-Protein/dp/B0AISLE002?ref_=e2e");
  await input.press("Enter");
  await expect(page.getByText("All variants found")).toBeVisible();
  await expect(page.getByText("Chocolate · 1 kg").first()).toBeVisible();
  await expect(page.getByText(/5 variants/)).toBeVisible();
  await page.getByRole("button", { name: /Start monitoring/ }).click();
  await expect(page.getByRole("heading", { name: /Tracking 5 variants/ })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("add a competitor and create the comparison", async () => {
  await page.getByRole("button", { name: /Add a competitor/ }).click();
  await page.getByRole("button", { name: "Northfield Vegan Protein" }).click();
  await expect(page.getByText("Northfield Labs").first()).toBeVisible();
  await page.getByRole("button", { name: /Start monitoring/ }).click();
  await expect(page.getByRole("heading", { name: /Tracking \d+ variants/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Comparison name").fill("Plant Protein — India");
  await page.getByRole("button", { name: /Open my dashboard/ }).click();
  await expect(page).toHaveURL(/\/comparisons\//);
  await expect(page.getByRole("heading", { name: "Plant Protein — India" })).toBeVisible();
});

test("compare current and normalized prices", async () => {
  await expect(page.getByText("Comparable listings")).toBeVisible();
  await expect(page.getByRole("button", { name: /Sort by Unit \/100 g/ })).toBeVisible();
  await expect(page.getByText("Reference vs median")).toBeVisible();
  await expect(page.getByText("No reference listing")).toHaveCount(0);
  await expect(page.locator("tbody tr")).toHaveCount(9);
  await expect(page.getByText(/is the lowest-priced comparable option/)).toBeVisible();
  await page.getByRole("radio", { name: "Visual" }).click();
  await expect(page.getByText("Relative to competitor median")).toBeVisible();
  await page.getByRole("radio", { name: "Timeline" }).click();
  await expect(page.getByText("Price over time")).toBeVisible();
  await expect(page.getByRole("img", { name: /Price history for/ })).toBeVisible();
});

test("inspect price history with a different range", async () => {
  await page.getByRole("radio", { name: "7D" }).click();
  await expect(page.locator("th", { hasText: "Coverage" }).first()).toBeAttached();
  await page.getByRole("button", { name: /^Table$/ }).last().click();
  await expect(page.locator("caption", { hasText: "Observations" })).toBeAttached();
});

test("create a price-drop alert", async () => {
  await page.goto("/alerts?new=1");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Threshold").fill("4");
  await page.getByRole("button", { name: "Create alert" }).click();
  await expect(page.getByText("Alert created")).toBeVisible();
  await expect(page.getByText("Price falls by a percentage").first()).toBeVisible();
});

test("trigger a monitoring refresh and see it persist", async () => {
  await page.goto("/products");
  await page.getByRole("link", { name: /Plant Protein Powder/ }).first().click();
  await expect(page.getByRole("tab", { name: /Variants/ })).toBeVisible();
  await page.getByRole("button", { name: "Refresh now" }).click();
  await expect(page.getByText(/Refreshed \d+ listing|refresh for these listings was just requested/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: /Monitoring & data/ }).click();
  await expect(page.getByText("Recently verified").first()).toBeVisible();
});

test("dashboard reflects the new data after a reload", async () => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your market, in focus." })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Products tracked")).toBeVisible();
  await expect(page.getByText(/monitored variants/)).toBeVisible();
});

test("export a comparison report", async () => {
  await page.goto("/comparisons");
  await page.getByRole("link", { name: /Plant Protein — India/ }).click();
  await page.getByRole("button", { name: "Export" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/competitive-pricing-snapshot.*\.csv$/);
});

test("key screens have no serious accessibility violations", async () => {
  for (const path of ["/", "/products", "/comparisons", "/alerts", "/settings"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${path}: ${v.id} — ${v.help}`)).toEqual([]);
  }
});
