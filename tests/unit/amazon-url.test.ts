import { describe, expect, it } from "vitest";
import { isValidAsin, parseManyInputs, parseProductInput } from "@/lib/amazon-url";

describe("parseProductInput", () => {
  const cases: [string, string, string][] = [
    ["https://www.amazon.in/OZ-Plant-Protein/dp/B0CXJ8QZ7M?ref_=abc&th=1", "IN", "B0CXJ8QZ7M"],
    ["https://amazon.in/dp/B0CXJ8QZ7M", "IN", "B0CXJ8QZ7M"],
    ["https://m.amazon.in/gp/aw/d/B0CXJ8QZ7M/ref=xyz", "IN", "B0CXJ8QZ7M"],
    ["https://www.amazon.com/gp/product/B08N5WRWNW?psc=1", "US", "B08N5WRWNW"],
    ["www.amazon.co.uk/dp/product/B08N5WRWNW", "GB", "B08N5WRWNW"],
    ["https://www.amazon.de/exec/obidos/ASIN/3446264655", "DE", "3446264655"],
    ["https://www.amazon.co.jp/-/en/dp/B0CXJ8QZ7M", "JP", "B0CXJ8QZ7M"],
    ["https://www.amazon.ae/gp/offer-listing/B0CXJ8QZ7M", "AE", "B0CXJ8QZ7M"],
    ["https://www.amazon.com.au/product-reviews/B0CXJ8QZ7M", "AU", "B0CXJ8QZ7M"],
    ["https://www.amazon.ca/s?k=x&asin=B0CXJ8QZ7M", "CA", "B0CXJ8QZ7M"],
    ["http://amzn.com/B08N5WRWNW", "US", "B08N5WRWNW"],
  ];
  it.each(cases)("parses %s", (url, mp, asin) => {
    const r = parseProductInput(url, "IN");
    expect(r.kind).toBe("listing");
    if (r.kind === "listing") {
      expect(r.marketplace).toBe(mp);
      expect(r.asin).toBe(asin);
      expect(r.marketplaceDetected).toBe(true);
      expect(r.canonicalUrl).toMatch(new RegExp(`/dp/${asin}$`));
    }
  });

  it("accepts bare ASINs using the default marketplace", () => {
    const r = parseProductInput(" b0cxj8qz7m ", "GB");
    expect(r).toMatchObject({ kind: "listing", marketplace: "GB", asin: "B0CXJ8QZ7M", marketplaceDetected: false });
  });

  it("recognises short links without fetching them", () => {
    expect(parseProductInput("https://amzn.to/3xYz12", "IN")).toMatchObject({ kind: "short_link", host: "amzn.to" });
    expect(parseProductInput("a.co/d/abc123", "IN")).toMatchObject({ kind: "short_link", host: "a.co" });
  });

  it("rejects look-alike and non-Amazon hosts (no suffix matching)", () => {
    expect(parseProductInput("https://www.amazon.in.evil.com/dp/B0CXJ8QZ7M", "IN")).toMatchObject({ kind: "error", code: "unsupported_host" });
    expect(parseProductInput("https://example.com/dp/B0CXJ8QZ7M", "IN")).toMatchObject({ kind: "error", code: "unsupported_host" });
    expect(parseProductInput("https://user:pw@www.amazon.in/dp/B0CXJ8QZ7M", "IN")).toMatchObject({ kind: "error" });
    expect(parseProductInput("https://www.amazon.in:8443/dp/B0CXJ8QZ7M", "IN")).toMatchObject({ kind: "error" });
  });

  it("explains unsupported storefronts and pages without a product", () => {
    expect(parseProductInput("https://www.amazon.cn/dp/B0CXJ8QZ7M", "IN")).toMatchObject({ kind: "error", code: "unsupported_marketplace" });
    expect(parseProductInput("https://www.amazon.in/s?k=protein", "IN")).toMatchObject({ kind: "error", code: "no_asin" });
    expect(parseProductInput("ftp://www.amazon.in/dp/B0CXJ8QZ7M", "IN")).toMatchObject({ kind: "error", code: "insecure_scheme" });
    expect(parseProductInput("HELLOWORLD", "IN")).toMatchObject({ kind: "error", code: "invalid_asin" });
    expect(parseProductInput("", "IN")).toMatchObject({ kind: "error", code: "empty" });
  });

  it("validates ASIN shapes", () => {
    expect(isValidAsin("B0CXJ8QZ7M")).toBe(true);
    expect(isValidAsin("0306406152")).toBe(true);
    expect(isValidAsin("A0CXJ8QZ7M")).toBe(false);
    expect(isValidAsin("B0CXJ8QZ7")).toBe(false);
  });
});

describe("parseManyInputs", () => {
  it("splits pasted lists and collapses different URLs for the same listing", () => {
    const blob = `https://www.amazon.in/dp/B0CXJ8QZ7M?ref=1
      https://amazon.in/Some-Title/dp/B0CXJ8QZ7M/ , B0CXJ8QZ8N; https://www.amazon.com/dp/B0CXJ8QZ7M`;
    const r = parseManyInputs(blob, "IN");
    const listings = r.filter((x) => x.kind === "listing");
    expect(listings).toHaveLength(4);
    expect(r.filter((x) => "duplicateOf" in x && x.duplicateOf)).toHaveLength(1);
    // Same ASIN on another marketplace is a different listing.
    expect(listings.some((l) => l.kind === "listing" && l.marketplace === "US")).toBe(true);
  });
});
