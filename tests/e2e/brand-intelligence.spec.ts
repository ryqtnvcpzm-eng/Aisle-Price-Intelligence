import { expect, test, type Page } from "@playwright/test";

/**
 * Regression scenario for features 1–6 with a brand-new account in demo mode.
 * The brand chosen as "mine" is deliberately not the demo catalog's usual one,
 * to prove the reference brand is data, not code. No email is sent: the server
 * runs without an email provider, and the UI must say so.
 */
test.describe.configure({ mode: "serial" });

const email = `brand-${Date.now()}@aisle.test`;
let page: Page;
const placeholderAsins = Array.from({ length: 30 }, (_, i) => `B0E2E${String(i).padStart(5, "0")}`);

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
});

test("onboarding asks which brand is yours and builds its comparisons", async () => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Brand Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/welcome/);
  await page.getByRole("button", { name: /Get started/ }).click();
  await page.getByRole("button", { name: /amazon\.in/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  for (const sample of ["Pureform Organic Protein", "Lumen Plant Protein"]) {
    await page.getByRole("button", { name: /Paste an Amazon link|Add a competitor/ }).click();
    await page.getByRole("button", { name: sample }).click();
    await page.getByRole("button", { name: /Start monitoring/ }).click();
    await expect(page.getByRole("heading", { name: /Tracking \d+ variants?/ })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Which brand is yours?" })).toBeVisible();
  await page.getByRole("radio", { name: /Pureform/ }).click();
  await page.getByRole("button", { name: /This is my brand/ }).click();
  await expect(page.getByText(/Pureform vs Market · Plant Protein · per 100 g/)).toBeVisible();
  await page.getByRole("button", { name: /Open my dashboard/ }).click();
  await expect(page).toHaveURL(/\/comparisons\//);
  await expect(page.getByText("Kept in sync by Aisle")).toBeVisible();
});

test("Overview offers Protect My Brand, and Alerts shows the pack", async () => {
  await page.goto("/");
  await expect(page.getByText("My brand", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Protect My Brand/ }).click();
  await expect(page.getByText("Protect My Brand is on")).toBeVisible();
  await page.goto("/alerts");
  const section = page.locator("#protect");
  await expect(section.getByText("On", { exact: true })).toBeVisible();
  for (const label of ["Competitor undercut", "Leadership change", "You go out of stock", "Rival drops 5%+"]) await expect(section.getByText(label)).toBeVisible();
  await expect(page.getByText(/Protect My Brand rules?, managed as one pack/)).toBeVisible();
});

test("email controls are honest when no provider is configured", async () => {
  await page.goto("/settings#notifications");
  await expect(page.getByText("Email isn't set up")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Email alerts" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Send test email/ })).toBeDisabled();
});

test("changing your brand previews the impact before anything changes", async () => {
  await page.goto("/brands");
  await expect(page.locator("#my-brand-title")).toHaveText("Pureform");
  await page.getByRole("button", { name: "Change…" }).click();
  const dialog = page.getByRole("dialog", { name: "Which brand is yours?" });
  await dialog.getByRole("radio", { name: /Lumen Nutrition/ }).click();
  await expect(dialog.getByText("What changes")).toBeVisible();
  await expect(dialog.getByText(/updated/)).toBeVisible();
  await dialog.getByRole("button", { name: "Use Lumen Nutrition" }).click();
  await expect(page.getByText("Lumen Nutrition is now your brand")).toBeVisible();
  await expect(page.locator("#my-brand-title")).toHaveText("Lumen Nutrition");
  await page.goto("/comparisons");
  await expect(page.getByText(/Lumen Nutrition vs Market · Plant Protein/)).toBeVisible();
  await expect(page.getByText(/Pureform vs Market/)).toHaveCount(0);
});

test("bulk-edits tags with a structured result", async () => {
  await page.goto("/products");
  const cards = page.getByRole("button", { name: /^Select / });
  // Each click turns "Select …" into "Deselect …", so the next unselected card is always first.
  await cards.first().click();
  await cards.first().click();
  await page.getByRole("toolbar", { name: "Bulk actions" }).getByRole("button", { name: "Edit" }).click();
  await page.getByRole("menuitem", { name: "Edit tags…" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit tags" });
  await dialog.getByLabel("Tags").fill("launch");
  await dialog.getByLabel("Tags").press("Enter");
  await dialog.getByRole("button", { name: /Apply to 2 products/ }).click();
  await expect(dialog.getByText("2 of 2 updated")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
});

test("queues a 30-link bulk import and follows it to completion", async () => {
  await page.goto("/products");
  await page.getByRole("button", { name: /Add product/ }).first().click();
  const input = page.getByLabel("Amazon product links or ASINs");
  await input.fill(placeholderAsins.join("\n"));
  await page.getByRole("button", { name: /Set up bulk import · 30 links/ }).click();
  await expect(page.getByText("30 links", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Import 30 links/ }).click();
  await expect(page).toHaveURL(/\/imports\//);
  await expect(page.getByText("Finished", { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/30 imported · 0 skipped · 0 failed/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /Export CSV/ }).click();
  expect((await download).suggestedFilename()).toMatch(/^aisle-import-.*\.csv$/);
  await page.goto("/imports");
  await expect(page.getByText(/30 of 30 links/)).toBeVisible();
});

test("builds last week's Monday Briefing with every section", async () => {
  await page.goto("/briefing");
  const build = page.getByRole("button", { name: /Build last week/ });
  await build.first().click();
  await expect(page).toHaveURL(/\/briefing\/\d{4}-\d{2}-\d{2}$/);
  for (const eyebrow of ["A · Summary", "B · Position", "C · Movers", "D · Undercuts & leadership", "E · Drops of 5% or more", "F · Trend", "G · Data confidence"]) {
    await expect(page.getByText(eyebrow, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(/Asia\/Kolkata/)).toBeVisible();
});
