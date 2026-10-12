import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CreatorsProvider, mapCreatorsItem } from "@/server/providers/creators";

const fixture = JSON.parse(readFileSync("tests/fixtures/creators-getitems.json", "utf8"));
const at = new Date("2026-06-01T00:00:00Z");

describe("Creators API mapping (contract)", () => {
  it("converts decimal major-unit prices to integer minor units and reads list price", () => {
    const p = mapCreatorsItem(fixture.itemsResult.items[0], "IN", at);
    expect(p.snapshot).toMatchObject({ priceMinor: 209_900, listPriceMinor: 279_900, currency: "INR", priceBasis: "buy_box", availability: "in_stock" });
    expect(p.snapshot?.seller).toEqual({ id: "A1EXAMPLESELLER", name: "Example Retail", isAmazon: false });
    expect(p.providerUpdatedAt).toBeNull(); // the API doesn't say — so we don't claim
    expect(p.variationAttributes).toEqual({ size_name: "1 kg", flavor_name: "Chocolate" });
  });

  it("recognises Amazon as seller and out-of-stock offers", () => {
    const p = mapCreatorsItem(fixture.itemsResult.items[1], "IN", at);
    expect(p.snapshot).toMatchObject({ priceMinor: 199_950, availability: "out_of_stock", amazonPriceMinor: 199_950 });
    expect(p.snapshot?.seller?.isAmazon).toBe(true);
    expect(p.brand).toBeNull();
  });

  it("is lookup-only unless the operator acknowledges the licence", () => {
    const base = { credentialId: "id", credentialSecret: "s", version: "2.2", partnerTag: "t-21" };
    expect(new CreatorsProvider({ ...base, licenseAck: false }).capabilities.monitoring).toBe(false);
    expect(new CreatorsProvider({ ...base, licenseAck: true }).capabilities.monitoring).toBe(true);
    expect(new CreatorsProvider({ ...base, licenseAck: true }).capabilities.priceHistory).toBe(false);
  });

  it("authenticates with client credentials and sends the marketplace header", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(new Response(JSON.stringify(String(url).includes("oauth2/token") ? { access_token: "tok", expires_in: 3600 } : fixture), { status: 200 })),
    );
    const p = new CreatorsProvider({ credentialId: "id", credentialSecret: "s", version: "2.2", partnerTag: "t-21", licenseAck: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    const batch = await p.getProducts("IN", ["B0CXJ8QZ7M", "B0CXJ8QZ9P", "B0CXJ8QZ8N"]);
    const [tokenCall, itemsCall] = fetchImpl.mock.calls;
    expect(String(tokenCall![0])).toBe("https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token");
    expect(String(itemsCall![0])).toBe("https://creatorsapi.amazon/catalog/v1/getItems");
    expect(itemsCall![1].headers["x-marketplace"]).toBe("www.amazon.in");
    expect(itemsCall![1].headers.Authorization).toBe("Bearer tok, Version 2.2");
    expect(JSON.parse(itemsCall![1].body)).toMatchObject({ partnerTag: "t-21", itemIds: ["B0CXJ8QZ7M", "B0CXJ8QZ9P", "B0CXJ8QZ8N"] });
    expect(batch.missing).toEqual(["B0CXJ8QZ8N"]);
  });
});
