import { describe, expect, it } from "vitest";
import { buildCohorts, cohortBasis, cohortKey, cohortName, type CohortInput } from "@/lib/cohorts";
import { alertEmail, escapeHtml } from "@/server/notifications/templates";

const row = (o: Partial<CohortInput> & { variantId: string }): CohortInput => ({
  familyId: `f-${o.variantId}`,
  familyTitle: "Product",
  label: "1 kg",
  brandId: "rival",
  brandName: "Rival",
  marketplace: "IN",
  categoryName: "Plant Protein",
  tracked: true,
  hidden: false,
  quantities: [{ dimension: "mass" }],
  ...o,
});

describe("cohorts", () => {
  it("groups only listings that share marketplace, category and unit", () => {
    const { cohorts, unmatched } = buildCohorts(
      [
        row({ variantId: "mine-1", brandId: "mine", brandName: "Mine" }),
        row({ variantId: "rival-1" }),
        row({ variantId: "rival-us", marketplace: "US" }), // other marketplace → own cohort without a reference
        row({ variantId: "rival-ml", quantities: [{ dimension: "volume" }] }), // other unit
        row({ variantId: "no-qty", quantities: [] }),
        row({ variantId: "untracked", tracked: false }),
        row({ variantId: "mine-solo", brandId: "mine", categoryName: "Vitamin C", quantities: [{ dimension: "count" }] }),
      ],
      "mine",
    );
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0]).toMatchObject({ key: "IN|plant-protein|per_100g", referenceVariantIds: ["mine-1"], competitorVariantIds: ["rival-1"] });
    const reasons = Object.fromEntries(unmatched.map((u) => [u.variantId, u.reason]));
    expect(reasons).toEqual({ "rival-us": "no_reference_in_cohort", "rival-ml": "no_reference_in_cohort", "no-qty": "no_quantity", "mine-solo": "no_competitor_in_cohort" });
  });

  it("uses whatever brand id it is given — nothing is special about any brand name", () => {
    const rows = [row({ variantId: "a", brandId: "x", brandName: "X" }), row({ variantId: "b", brandId: "y", brandName: "Y" })];
    expect(buildCohorts(rows, "x").cohorts[0]!.referenceVariantIds).toEqual(["a"]);
    expect(buildCohorts(rows, "y").cohorts[0]!.referenceVariantIds).toEqual(["b"]);
  });

  it("prefers mass, then volume, count and serving for the basis, and names cohorts from data", () => {
    expect(cohortBasis([{ dimension: "serving" }, { dimension: "mass" }])).toBe("per_100g");
    expect(cohortBasis([{ dimension: "count" }])).toBe("per_unit");
    expect(cohortBasis([])).toBeNull();
    expect(cohortKey("IN", null, "per_unit")).toBe("IN|uncategorized|per_unit");
    expect(cohortName("Acme", { categoryName: "Serums", basis: "per_100ml", marketplace: "IN" }, false)).toBe("Acme vs Market · Serums · per 100 ml");
    expect(cohortName("Acme", { categoryName: null, basis: "per_unit", marketplace: "US" }, true)).toBe("Acme vs Market · Uncategorized · per tablet, capsule or item · US");
  });
});

describe("email templates", () => {
  it("escapes every dynamic value in HTML and labels simulated and test messages", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    const e = alertEmail({ headline: "<script>alert(1)</script> dropped 8%", detail: "₹1,000 → ₹920", ruleName: "Rival drop", workspaceName: "Team & Co", url: "https://app.example/alerts?event=1", simulated: true, test: true });
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).toContain("Team &amp; Co");
    expect(e.subject.startsWith("[Test] [Simulated] ")).toBe(true);
    expect(e.text).toContain("SIMULATED demo data");
    expect(e.text).toContain("No price event occurred");
  });
});
