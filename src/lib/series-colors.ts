/**
 * Categorical color assignment. Colors follow the *entity* (brand), never its
 * rank: the reference brand always takes slot 1, competitors take slots 2–8 in
 * stable alphabetical order, and a 9th+ brand folds to the neutral "other".
 * Order validated with the dataviz palette validator (light & dark).
 */
export const SERIES_VARS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"] as const;
export const OTHER_VAR = "var(--series-other)";

export function brandColorMap(brands: { name: string | null; isReference: boolean }[]): Map<string, string> {
  const map = new Map<string, string>();
  const ref = brands.find((b) => b.isReference && b.name);
  if (ref?.name) map.set(ref.name, SERIES_VARS[0]);
  const others = [...new Set(brands.filter((b) => b.name && b.name !== ref?.name).map((b) => b.name!))].sort((a, b) => a.localeCompare(b));
  others.forEach((name, i) => map.set(name, SERIES_VARS[i + (ref ? 1 : 0)] ?? OTHER_VAR));
  return map;
}

/** Line dash patterns: secondary encoding for multiple variants of one brand. */
export const DASHES = ["0", "6 4", "2 3", "10 4 2 4"] as const;
