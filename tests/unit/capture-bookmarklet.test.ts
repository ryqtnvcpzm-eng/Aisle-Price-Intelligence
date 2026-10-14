/**
 * The capture bookmarklet against Amazon.in-shaped HTML fixtures. The tests
 * evaluate the same source string that ships in the bookmark, both the
 * extractor on its own and the whole bookmarklet in a simulated page.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { bookmarkletHref, bookmarkletSource, EXTRACTOR_SOURCE, LIST_PRICE_FALLBACK, type CapturePayload } from "@/lib/capture/bookmarklet";

interface Extractor {
  parsePriceMinor(t: string | null): number | null;
  extract(doc: Document, href: string): CapturePayload;
}
const X = new Function(`return ${EXTRACTOR_SOURCE}`)() as Extractor;
const fixture = (name: string) => readFileSync(path.join(__dirname, "../fixtures/amazon-in", name), "utf8");
const page = (name: string, url: string) => new JSDOM(fixture(name), { url });

describe("price parsing (paise)", () => {
  it.each([
    ["₹1,299.00", 129_900],
    ["₹1,299", 129_900],
    ["₹ 899.50", 89_950],
    ["₹ 899.5", 89_950],
    ["₹1,29,999.00", 12_999_900],
    ["Rs. 49", 4_900],
    ["  ₹0.99 ", 99],
  ])("%s → %d", (text, minor) => expect(X.parsePriceMinor(text)).toBe(minor));

  it.each([["₹199.00 - ₹499.00"], ["Currently unavailable."], [""], ["₹"]])("%s → null (not one price)", (text) => expect(X.parsePriceMinor(text)).toBeNull());
});

describe("extraction from product pages", () => {
  it("reads the core price block, title, both twister selections, availability and the deal badge", () => {
    const d = X.extract(page("core-price.html", "https://www.amazon.in/Fixture-Plant-Protein/dp/B0FIXT0001/ref=sr_1_1?keywords=protein&tag=x").window.document, "https://www.amazon.in/Fixture-Plant-Protein/dp/B0FIXT0001/ref=sr_1_1?keywords=protein&tag=x");
    expect(d).toMatchObject({
      asin: "B0FIXT0001",
      title: "Fixture Nutrition Plant Protein Powder, Chocolate, 1 kg",
      priceMinor: 129_900,
      currency: "INR",
      selector: "#corePrice_feature_div .a-offscreen",
      isDeal: true,
      variantLabel: "1 kg · Chocolate",
      availability: "In stock",
      // Tracking parameters and the slug are dropped.
      url: "https://www.amazon.in/dp/B0FIXT0001",
    });
    expect(Number.isNaN(Date.parse(d.capturedAt))).toBe(false);
  });

  it("falls back to the deal price block, and records it as a deal", () => {
    const d = X.extract(page("deal-price.html", "https://www.amazon.in/dp/B0FIXT0002").window.document, "https://www.amazon.in/dp/B0FIXT0002");
    expect(d).toMatchObject({ asin: "B0FIXT0002", priceMinor: 89_950, selector: "#priceblock_dealprice", isDeal: true, variantLabel: "120 Tablets", availability: "Only 3 left in stock." });
  });

  it("reads the 'our price' block with Indian digit grouping", () => {
    const d = X.extract(page("our-price.html", "https://www.amazon.in/gp/product/B0FIXT0003?th=1").window.document, "https://www.amazon.in/gp/product/B0FIXT0003?th=1");
    expect(d).toMatchObject({ asin: "B0FIXT0003", priceMinor: 12_999_900, selector: "#priceblock_ourprice", isDeal: false, variantLabel: null });
  });

  it("records which selector matched when only the struck-through price exists", () => {
    const d = X.extract(page("list-price-only.html", "https://www.amazon.in/s?k=serum").window.document, "https://www.amazon.in/s?k=serum");
    expect(d).toMatchObject({ asin: "B0FIXT0004", priceMinor: 74_900, selector: LIST_PRICE_FALLBACK }); // ASIN from the #ASIN element
  });

  it("returns a null price with the availability text when the item is out of stock", () => {
    const d = X.extract(page("out-of-stock.html", "https://www.amazon.in/dp/B0FIXT0005").window.document, "https://www.amazon.in/dp/B0FIXT0005");
    expect(d).toMatchObject({ asin: "B0FIXT0005", priceMinor: null, selector: null, availability: "Currently unavailable.", variantLabel: "2 kg" });
  });

  it("refuses to pick a number out of a price range", () => {
    const d = X.extract(page("price-range.html", "https://www.amazon.in/dp/B0FIXT0006").window.document, "https://www.amazon.in/dp/B0FIXT0006");
    expect(d.priceMinor).toBeNull();
    expect(d.selector).toBeNull();
  });
});

/** Run the full bookmarklet inside a fixture page with a stubbed fetch, as a browser would. */
async function click(fixtureName: string, url: string, respond: (body: CapturePayload) => { status: number; json: unknown } | Error) {
  const dom = new JSDOM(fixture(fixtureName), { url, runScripts: "outside-only", pretendToBeVisual: true });
  const calls: { url: string; init: RequestInit; body: CapturePayload }[] = [];
  const opened: string[] = [];
  dom.window.fetch = vi.fn(async (u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as CapturePayload;
    calls.push({ url: u, init, body });
    const r = respond(body);
    if (r instanceof Error) throw r;
    return { ok: r.status < 300, status: r.status, json: async () => r.json } as Response;
  }) as typeof fetch;
  dom.window.open = ((u: string) => {
    opened.push(u);
    return {} as Window;
  }) as typeof window.open;
  const href = bookmarkletHref({ appUrl: "https://aisle.example/", token: "tok_test_123" });
  expect(href.startsWith("javascript:")).toBe(true);
  dom.window.eval(decodeURIComponent(href.slice("javascript:".length)));
  await new Promise((r) => setTimeout(r, 20));
  const toast = dom.window.document.getElementById("aisle-capture-toast");
  return { calls, opened, toast: toast?.textContent ?? null, toastLink: toast?.querySelector("a")?.getAttribute("href") ?? null };
}

describe("the bookmarklet", () => {
  it("posts the capture with the bearer token, without cookies, and confirms on the page", async () => {
    const r = await click("core-price.html", "https://www.amazon.in/dp/B0FIXT0001", () => ({ status: 200, json: { capture: { status: "recorded", variant: "1 kg · Chocolate" } } }));
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.url).toBe("https://aisle.example/api/capture");
    expect(r.calls[0]!.init).toMatchObject({ method: "POST", mode: "cors", credentials: "omit" });
    expect((r.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok_test_123");
    expect(r.calls[0]!.body).toMatchObject({ asin: "B0FIXT0001", priceMinor: 129_900, selector: "#corePrice_feature_div .a-offscreen", isDeal: true });
    expect(r.toast).toContain("Captured");
    expect(r.toast).toContain("Fixture Nutrition Plant Protein Powder");
    expect(r.toast).toContain("₹1,299");
  });

  it("still posts when no price is found, and says why", async () => {
    const r = await click("out-of-stock.html", "https://www.amazon.in/dp/B0FIXT0005", () => ({ status: 200, json: { capture: { status: "recorded" } } }));
    expect(r.calls[0]!.body).toMatchObject({ priceMinor: null, availability: "Currently unavailable." });
    expect(r.toast).toContain("Availability: Currently unavailable.");
  });

  it("offers a one-click import for an untracked ASIN", async () => {
    const r = await click("our-price.html", "https://www.amazon.in/dp/B0FIXT0003", () => ({ status: 404, json: { error: "untracked_asin", asin: "B0FIXT0003", importUrl: "https://aisle.example/products?import=https%3A%2F%2Fwww.amazon.in%2Fdp%2FB0FIXT0003" } }));
    expect(r.toast).toContain("Not tracked yet");
    expect(r.toastLink).toBe("https://aisle.example/products?import=https%3A%2F%2Fwww.amazon.in%2Fdp%2FB0FIXT0003");
  });

  it("hands off to an Aisle window when the page blocks the request, without putting the token in the URL", async () => {
    const r = await click("deal-price.html", "https://www.amazon.in/dp/B0FIXT0002", () => new TypeError("Failed to fetch"));
    expect(r.opened).toHaveLength(1);
    expect(r.opened[0]!.startsWith("https://aisle.example/capture/receive#")).toBe(true);
    expect(r.opened[0]).not.toContain("tok_test_123");
    expect(JSON.parse(decodeURIComponent(r.opened[0]!.split("#")[1]!))).toMatchObject({ asin: "B0FIXT0002", priceMinor: 89_950 });
  });

  it("does nothing outside amazon.in or off a product page", async () => {
    const off = await click("core-price.html", "https://www.amazon.com/dp/B0FIXT0001", () => ({ status: 200, json: {} }));
    expect(off.calls).toHaveLength(0);
    expect(off.toast).toContain("Not an Amazon.in page");
    const blank = new JSDOM("<!doctype html><body><p>Search results</p></body>", { url: "https://www.amazon.in/s?k=x", runScripts: "outside-only" });
    blank.window.fetch = vi.fn() as typeof fetch;
    blank.window.eval(bookmarkletSource({ appUrl: "https://aisle.example", token: "t" }));
    expect(blank.window.fetch).not.toHaveBeenCalled();
    expect(blank.window.document.getElementById("aisle-capture-toast")?.textContent).toContain("No product found");
  });

  it("never writes page text as HTML", () => {
    const src = bookmarkletSource({ appUrl: "https://aisle.example", token: "t" });
    expect(src).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
  });
});
