import { parseQuantities, type ParsedQuantity } from "@/lib/quantity";

export function variantLabel(attributes: Record<string, string> | null, sizeText: string | null): string {
  const vals = Object.values(attributes ?? {}).filter(Boolean);
  if (vals.length) return vals.join(" · ");
  return sizeText || "Standard";
}

/** Parse quantities from the most specific text first: variation values → size field → title. */
export function quantitiesFor(p: { variationAttributes: Record<string, string> | null; sizeText: string | null; title: string | null }): ParsedQuantity[] {
  const specific = [...Object.values(p.variationAttributes ?? {}), p.sizeText ?? ""].join(" ").trim();
  const fromSpecific = parseQuantities(specific);
  const fromTitle = parseQuantities(p.title);
  const out = [...fromSpecific];
  for (const q of fromTitle) {
    if (out.some((x) => x.dimension === q.dimension)) continue;
    // A title's grams are often per-serving claims; only trust them when nothing more specific exists.
    if (q.dimension === "mass" && fromSpecific.length) continue;
    out.push(q);
  }
  return out;
}
