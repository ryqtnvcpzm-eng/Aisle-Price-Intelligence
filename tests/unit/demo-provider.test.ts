import { describe, expect, it } from "vitest";
import { DEMO_FAMILIES } from "@/server/providers/demo/catalog";
import { DemoProvider } from "@/server/providers/demo";
import { charm, simulate } from "@/server/providers/demo/simulate";

describe("demo provider", () => {
  const at = new Date("2026-09-01T10:00:00Z");
  const p = new DemoProvider(() => at);

  it("is deterministic and always labelled simulated", async () => {
    const asin = DEMO_FAMILIES[0]!.variants[1]!.asin;
    const a = await p.getProducts("IN", [asin]);
    const b = await new DemoProvider(() => at).getProducts("IN", [asin]);
    expect(a.products[0]!.snapshot?.priceMinor).toBe(b.products[0]!.snapshot?.priceMinor);
    expect(a.products[0]!.isSimulated).toBe(true);
  });

  it("produces charm prices in whole rupees and dollars-and-99", () => {
    expect(charm(209_000, "INR") % 100).toBe(0);
    expect(charm(19_950, "USD") % 100).toBe(99);
    const { points } = simulate("B0AISLE002", 209_900, "INR", at);
    expect(points.every((x) => x.priceMinor === null || x.priceMinor % 100 === 0)).toBe(true);
  });

  it("answers unknown ASINs honestly instead of inventing a product", async () => {
    const r = await p.getProducts("IN", ["B0ZZZZZZZZ"]);
    expect(r.products[0]!.title).toBe("Demo listing · B0ZZZZZZZZ");
    expect(r.products[0]!.brand).toBeNull();
    expect(r.variations.get("B0ZZZZZZZZ")!.completeness).toBe("unavailable");
  });

  it("reports partial discovery for the partial demo family", async () => {
    const fam = DEMO_FAMILIES.find((f) => f.partialDiscovery)!;
    const v = await p.getVariations("IN", fam.variants[0]!.asin);
    expect(v.completeness).toBe("partial");
    expect(v.children.length).toBe(fam.variants.length - 1);
  });

  it("can simulate provider failures for retry testing", async () => {
    const q = new DemoProvider(() => at);
    q.simulateFailure("quota_exhausted");
    await expect(q.getProducts("IN", ["B0AISLE001"])).rejects.toMatchObject({ kind: "quota_exhausted" });
    await expect(q.getProducts("IN", ["B0AISLE001"])).resolves.toBeTruthy();
  });
});
