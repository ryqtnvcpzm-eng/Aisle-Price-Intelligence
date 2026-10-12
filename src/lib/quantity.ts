/**
 * Quantity parsing and unit-price normalization.
 *
 * Quantities are stored as integer *milli base units* (mg, µL·1000 = mL·1000,
 * count·1000) so that "2 × 500 g", "1 kg" and "1000 g" compare exactly.
 * Every parse keeps its source text and a confidence; nothing parsed is ever
 * presented as verified — only manual corrections or explicit provider fields are.
 */
import { divRound } from "./money";

export type Dimension = "mass" | "volume" | "count" | "serving";
export type BaseUnit = "g" | "ml" | "unit" | "serving";
export type QuantityConfidence = "provider" | "parsed" | "manual" | "unknown";

export interface ParsedQuantity {
  dimension: Dimension;
  /** Number of individual containers/packs. */
  packCount: number;
  /** Amount per pack in the *display* unit (e.g. 500 for "500 g"). */
  unitAmount: number;
  unit: string;
  /** Total quantity in milli base units: mass→mg, volume→µL·, count→milli-count. */
  totalMilli: number;
  /** For counts: what's being counted (tablet, capsule, item...). */
  countNoun?: string;
  sourceText: string;
  matchedText: string;
  confidence: QuantityConfidence;
}

export const BASE_UNIT: Record<Dimension, BaseUnit> = { mass: "g", volume: "ml", count: "unit", serving: "serving" };

/** unit token → [dimension, milli-base per 1 unit] */
const UNIT_TABLE: Record<string, [Dimension, number]> = {
  mg: ["mass", 1],
  g: ["mass", 1000],
  gm: ["mass", 1000],
  gms: ["mass", 1000],
  gr: ["mass", 1000],
  gram: ["mass", 1000],
  grams: ["mass", 1000],
  kg: ["mass", 1_000_000],
  kgs: ["mass", 1_000_000],
  kilo: ["mass", 1_000_000],
  kilogram: ["mass", 1_000_000],
  kilograms: ["mass", 1_000_000],
  lb: ["mass", 453_592],
  lbs: ["mass", 453_592],
  pound: ["mass", 453_592],
  pounds: ["mass", 453_592],
  oz: ["mass", 28_350],
  ounce: ["mass", 28_350],
  ounces: ["mass", 28_350],
  ml: ["volume", 1000],
  millilitre: ["volume", 1000],
  milliliter: ["volume", 1000],
  millilitres: ["volume", 1000],
  milliliters: ["volume", 1000],
  cl: ["volume", 10_000],
  l: ["volume", 1_000_000],
  ltr: ["volume", 1_000_000],
  litre: ["volume", 1_000_000],
  liter: ["volume", 1_000_000],
  litres: ["volume", 1_000_000],
  liters: ["volume", 1_000_000],
  "fl oz": ["volume", 29_574],
  "fl. oz": ["volume", 29_574],
  floz: ["volume", 29_574],
};

const COUNT_NOUNS = [
  "tablets", "tablet", "tabs", "capsules", "capsule", "caps", "softgels", "softgel", "gummies", "gummy",
  "veggie capsules", "vegetarian capsules", "sachets", "sachet", "pieces", "piece", "pcs", "count", "ct",
  "items", "item", "bars", "bar", "units", "unit", "pods", "pod", "sticks", "stick", "wipes", "rolls", "bags",
] as const;

const SINGULAR: Record<string, string> = {
  tablets: "tablet", tabs: "tablet", capsules: "capsule", caps: "capsule", "veggie capsules": "capsule",
  "vegetarian capsules": "capsule", softgels: "softgel", gummies: "gummy", sachets: "sachet", pieces: "item",
  piece: "item", pcs: "item", count: "item", ct: "item", items: "item", bars: "bar", units: "item", unit: "item",
  pods: "pod", sticks: "stick", wipes: "wipe", rolls: "roll", bags: "bag",
};

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const unitAlternation = Object.keys(UNIT_TABLE)
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[.]/g, "\\.").replace(/ /g, "\\s*"))
  .join("|");
const countAlternation = [...COUNT_NOUNS].sort((a, b) => b.length - a.length).map((u) => u.replace(/ /g, "\\s+")).join("|");

const MULTI_RE = new RegExp(String.raw`(\d+)\s*[x×*]\s*${NUM}\s*(${unitAlternation})\b`, "i");
const MEASURE_RE = new RegExp(String.raw`${NUM}\s*(${unitAlternation})\b`, "gi");
const PACK_RE = /\b(?:pack|set|box|case|bundle|combo)\s*of\s*(\d+)\b|\b(\d+)\s*[- ]?(?:pack|pk|packs)\b/i;
const COUNT_RE = new RegExp(String.raw`\b${NUM}\s*(${countAlternation})\b`, "i");
const SERVING_RE = new RegExp(String.raw`\b${NUM}\s*(?:servings?|serves|scoops?)\b`, "i");

function num(s: string): number {
  return Number(s.replace(",", "."));
}

function normalizeUnitToken(u: string): string {
  return u.toLowerCase().replace(/\s+/g, " ").replace("fl. oz", "fl oz");
}

/**
 * Parse every quantity dimension we can find in a text. Returns at most one
 * candidate per dimension, preferring explicit multipack expressions.
 */
export function parseQuantities(text: string | null | undefined): ParsedQuantity[] {
  if (!text) return [];
  const src = text.replace(/\u00a0/g, " ");
  const out = new Map<Dimension, ParsedQuantity>();

  const packMatch = src.match(PACK_RE);
  const packFromText = packMatch ? Number(packMatch[1] ?? packMatch[2]) : 1;

  const multi = src.match(MULTI_RE);
  let multiDimension: Dimension | null = null;
  if (multi) {
    const unitKey = normalizeUnitToken(multi[3]!);
    const entry = UNIT_TABLE[unitKey] ?? UNIT_TABLE[unitKey.replace(/\s/g, "")];
    if (entry) {
      const [dimension, perUnit] = entry;
      const packCount = Number(multi[1]);
      const unitAmount = num(multi[2]!);
      multiDimension = dimension;
      out.set(dimension, {
        dimension, packCount, unitAmount, unit: unitKey,
        totalMilli: Math.round(packCount * unitAmount * perUnit),
        sourceText: text, matchedText: multi[0], confidence: "parsed",
      });
    }
  }

  for (const m of src.matchAll(MEASURE_RE)) {
    const unitKey = normalizeUnitToken(m[2]!);
    const entry = UNIT_TABLE[unitKey] ?? UNIT_TABLE[unitKey.replace(/\s/g, "")];
    if (!entry) continue;
    const [dimension, perUnit] = entry;
    const unitAmount = num(m[1]!);
    if (unitAmount <= 0) continue;
    const existing = out.get(dimension);
    // Net contents are the largest stated measure; smaller ones are usually
    // per-serving claims ("24 g protein per scoop"). Explicit multipacks win.
    if (existing && (multiDimension === dimension || existing.totalMilli >= Math.round(packFromText * unitAmount * perUnit))) continue;
    out.set(dimension, {
      dimension, packCount: packFromText, unitAmount, unit: unitKey,
      totalMilli: Math.round(packFromText * unitAmount * perUnit),
      sourceText: text, matchedText: packMatch ? `${m[0]} · ${packMatch[0]}` : m[0], confidence: "parsed",
    });
  }

  const count = src.match(COUNT_RE);
  if (count) {
    const noun = count[2]!.toLowerCase().replace(/\s+/g, " ");
    const amount = num(count[1]!);
    if (amount > 0) {
      out.set("count", {
        dimension: "count", packCount: packFromText, unitAmount: amount, unit: SINGULAR[noun] ?? noun,
        countNoun: SINGULAR[noun] ?? noun, totalMilli: Math.round(packFromText * amount * 1000),
        sourceText: text, matchedText: count[0], confidence: "parsed",
      });
    }
  } else if (packMatch && !out.size) {
    out.set("count", {
      dimension: "count", packCount: packFromText, unitAmount: 1, unit: "pack", countNoun: "pack",
      totalMilli: packFromText * 1000, sourceText: text, matchedText: packMatch[0], confidence: "parsed",
    });
  }

  const serving = src.match(SERVING_RE);
  if (serving) {
    const amount = num(serving[1]!);
    if (amount > 0) {
      out.set("serving", {
        dimension: "serving", packCount: packFromText, unitAmount: amount, unit: "serving",
        totalMilli: Math.round(packFromText * amount * 1000), sourceText: text, matchedText: serving[0], confidence: "parsed",
      });
    }
  }

  // "1000 mg, 60 tablets" — milligrams next to a count are dosage, not net weight.
  const mass = out.get("mass");
  if (mass && out.has("count") && mass.unit === "mg") out.delete("mass");

  return [...out.values()];
}

/** Choose the most useful dimension for unit pricing: mass › volume › count › serving. */
export function primaryQuantity(qs: ParsedQuantity[]): ParsedQuantity | null {
  const order: Dimension[] = ["mass", "volume", "count", "serving"];
  for (const d of order) {
    const q = qs.find((x) => x.dimension === d);
    if (q) return q;
  }
  return null;
}

// ─── Normalization bases ────────────────────────────────────────────────────

export const NORMALIZATION_BASES = {
  per_100g: { dimension: "mass", refMilli: 100_000, label: "/100 g", long: "per 100 g" },
  per_kg: { dimension: "mass", refMilli: 1_000_000, label: "/kg", long: "per kilogram" },
  per_g: { dimension: "mass", refMilli: 1000, label: "/g", long: "per gram" },
  per_100ml: { dimension: "volume", refMilli: 100_000, label: "/100 ml", long: "per 100 ml" },
  per_l: { dimension: "volume", refMilli: 1_000_000, label: "/L", long: "per litre" },
  per_ml: { dimension: "volume", refMilli: 1000, label: "/ml", long: "per millilitre" },
  per_unit: { dimension: "count", refMilli: 1000, label: "/unit", long: "per tablet, capsule or item" },
  per_serving: { dimension: "serving", refMilli: 1000, label: "/serving", long: "per serving" },
  per_pack: { dimension: "pack", refMilli: 1000, label: "/pack", long: "per pack" },
} as const;

export type NormalizationBasis = keyof typeof NORMALIZATION_BASES;

export function isNormalizationBasis(v: unknown): v is NormalizationBasis {
  return typeof v === "string" && v in NORMALIZATION_BASES;
}

/** Sensible default basis for a quantity's dimension. */
export function defaultBasisFor(dimension: Dimension | null | undefined): NormalizationBasis | null {
  switch (dimension) {
    case "mass": return "per_100g";
    case "volume": return "per_100ml";
    case "count": return "per_unit";
    case "serving": return "per_serving";
    default: return null;
  }
}

export interface QuantityLike {
  dimension: Dimension;
  totalMilli: number;
  packCount: number;
}

/**
 * Unit price in integer minor units per reference quantity, or null when the
 * quantity doesn't share the basis's dimension (incomparable — never coerced).
 * Returns *centi-minor* precision when the per-unit price would round to 0.
 */
export function unitPriceMinor(
  priceMinor: number | null | undefined,
  quantities: QuantityLike[] | QuantityLike | null | undefined,
  basis: NormalizationBasis,
): number | null {
  if (priceMinor === null || priceMinor === undefined || !quantities) return null;
  const list = Array.isArray(quantities) ? quantities : [quantities];
  const def = NORMALIZATION_BASES[basis];
  if (def.dimension === "pack") {
    const q = list[0];
    const packs = q?.packCount ?? 1;
    if (packs <= 0) return null;
    return Number(divRound(BigInt(priceMinor), BigInt(packs)));
  }
  const q = list.find((x) => x.dimension === def.dimension);
  if (!q || q.totalMilli <= 0) return null;
  return Number(divRound(BigInt(priceMinor) * BigInt(def.refMilli), BigInt(q.totalMilli)));
}

export function formatQuantity(q: Pick<ParsedQuantity, "packCount" | "unitAmount" | "unit"> | null | undefined): string {
  if (!q) return "—";
  const amount = Number.isInteger(q.unitAmount) ? q.unitAmount.toString() : q.unitAmount.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  const unit = q.unit === "item" || q.unit === "pack" ? (q.unitAmount === 1 ? q.unit : `${q.unit}s`) : q.unit;
  const core = ["tablet", "capsule", "softgel", "gummy", "sachet", "bar", "pod", "stick", "wipe", "roll", "bag"].includes(q.unit)
    ? `${amount} ${q.unitAmount === 1 ? q.unit : q.unit === "gummy" ? "gummies" : `${q.unit}s`}`
    : `${amount} ${unit}`;
  return q.packCount > 1 ? `${q.packCount} × ${core}` : core;
}
