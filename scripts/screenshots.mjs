/**
 * Visual QA: sign in to the demo workspace and capture key screens in light
 * and dark, desktop and mobile. Usage:
 *   node scripts/screenshots.mjs [outDir] [route,route,...]
 * Requires the app running on BASE_URL (default http://localhost:3000).
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const out = process.argv[2] ?? "docs/screenshots";
const routes = (process.argv[3] ?? "/,/products,/comparisons,/history,/brands,/insights,/alerts,/reports,/activity,/settings").split(",");
const themes = (process.env.THEMES ?? "light,dark").split(",");
const sizes = (process.env.SIZES ?? "desktop,mobile").split(",");
mkdirSync(out, { recursive: true });

const viewports = { desktop: { width: 1440, height: 900 }, tablet: { width: 1024, height: 1366 }, mobile: { width: 390, height: 844 } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const size of sizes) {
  for (const theme of themes) {
    const ctx = await browser.newContext({ viewport: viewports[size], deviceScaleFactor: 2, colorScheme: theme, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/sign-in`);
    await page.getByRole("button", { name: /Explore the demo workspace/ }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 });
    for (const r of routes) {
      await page.goto(`${BASE}${r}`, { waitUntil: "networkidle" });
      await page.mouse.move(0, 0);
      await page.waitForTimeout(900);
      const name = `${r === "/" ? "overview" : r.replace(/^\//, "").replace(/[/?=&]/g, "_")}-${size}-${theme}.png`;
      await page.screenshot({ path: `${out}/${name}`, fullPage: process.env.FULL === "1" });
      console.log("captured", name);
    }
    await ctx.close();
  }
}
await browser.close();
