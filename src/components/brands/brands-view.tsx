"use client";

import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatMoney, formatPct, pctChange } from "@/lib/money";
import { brandColorMap, OTHER_VAR } from "@/lib/series-colors";
import { spring, staggerDelay } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { EmptyState, SectionHeader } from "../ui/empty-state";
import { Delta } from "../ui/price";
import { ProductImage } from "../ui/product-image";
import { Select } from "../ui/select";
import { MarketplaceTag } from "../ui/status";
import { Tag } from "lucide-react";

interface BrandData {
  name: string;
  brandId: string | null;
  isReference: boolean;
  families: number;
  variants: number;
  categories: string[];
  marketplaces: string[];
  comparableListings: number;
  medianPremium: number | null;
  premiumSamples: number;
  groupsCompeted: number;
  groupsLowest: number;
  discountedShare: number | null;
  inStockShare: number;
  avgChange7d: number | null;
  avgChange30d: number | null;
  movement30d: number | null;
  segment: { label: string; cluster: number } | null;
  products: { id: string; title: string; imageUrl: string | null; variants: number; marketplace: string }[];
  changes: { variantId: string; familyId: string; label: string; title: string; from: number; to: number; currency: string }[];
}

export function BrandsView({ stats, initialBrand }: { stats: BrandData[]; initialBrand: string | null }) {
  const [active, setActive] = useState<string | null>(initialBrand ?? stats[0]?.name ?? null);
  const ref = stats.find((s) => s.isReference);
  const [vs, setVs] = useState<string>(stats.find((s) => !s.isReference)?.name ?? "");
  const colors = useMemo(() => brandColorMap(stats.map((s) => ({ name: s.name, isReference: s.isReference }))), [stats]);
  const brand = stats.find((s) => s.name === active) ?? null;
  const other = stats.find((s) => s.name === vs) ?? null;

  if (!stats.length) return <EmptyState icon={<Tag />} title="No brands yet" description="Brands appear as you add products. Choose yours above to see how competitors price against it." />;

  const maxAbs = Math.max(0.05, ...stats.map((s) => Math.abs(s.medianPremium ?? 0)));

  return (
    <div className="space-y-6">
      {/* Premium chart — diverging, neutral midpoint */}
      <section className="card p-5">
        <SectionHeader title="Price position" description="Median unit-price premium vs. other brands in the same comparison groups" />
        <ul className="mt-4 space-y-2.5">
          {/* Highest premium first; brands without a comparison overlap sit last, muted. */}
          {[...stats].sort((a, b) => (a.medianPremium === null ? 1 : 0) - (b.medianPremium === null ? 1 : 0) || (b.medianPremium ?? 0) - (a.medianPremium ?? 0)).map((s, i) => (
            <motion.li key={s.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: staggerDelay(i) }}>
              <button onClick={() => setActive(s.name)} className={cn("grid w-full grid-cols-[160px_minmax(0,1fr)_72px] items-center gap-3 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--hairline)]", active === s.name && "bg-accent-softer")}>
                <span className={cn("flex items-center gap-2 truncate text-sm font-medium", s.medianPremium === null && "text-ink-3")}>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: colors.get(s.name) ?? OTHER_VAR }} />
                  <span className="truncate">{s.name}</span>
                </span>
                <span className="relative h-5">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--chart-axis)]" />
                  {s.medianPremium !== null && (
                    <motion.span
                      className={cn("absolute top-1 h-3 rounded-[3px]", s.medianPremium >= 0 ? "bg-up" : "bg-down")}
                      initial={{ width: 0 }}
                      animate={{ width: `${(Math.abs(s.medianPremium) / maxAbs) * 50}%` }}
                      transition={{ ...spring.gentle, delay: 0.1 + staggerDelay(i) }}
                      style={s.medianPremium >= 0 ? { left: "50%" } : { right: "50%" }}
                    />
                  )}
                </span>
                <span className="num text-right text-sm">{s.medianPremium === null ? <span className="text-xs text-ink-4">no overlap</span> : formatPct(s.medianPremium, { signed: true })}</span>
              </button>
            </motion.li>
          ))}
        </ul>
        <div className="mt-2 grid grid-cols-[160px_minmax(0,1fr)_72px] gap-3 px-2 text-2xs text-ink-3"><span /><span className="flex justify-between"><span>▼ cheaper</span><span>pricier ▲</span></span><span /></div>
      </section>

      <Segments stats={stats} colors={colors} onPick={setActive} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {brand && (
          <section className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight">{brand.name}</h2>
                  {brand.isReference && <Badge tone="accent" size="xs">Your brand</Badge>}
                  {brand.segment && <Badge tone="neutral" size="xs">{brand.segment.label}</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-ink-3">{brand.categories.join(" · ") || "No category"} · {brand.marketplaces.map((m) => m).join(", ")}</p>
              </div>
              <Select ariaLabel="Brand" size="sm" value={brand.name} onValueChange={setActive} options={stats.map((s) => ({ value: s.name, label: s.name }))} />
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Products" value={String(brand.families)} sub={`${brand.variants} variants`} />
              <Stat label="Comparable" value={String(brand.comparableListings)} sub="listings in groups" />
              <Stat label="Lowest price in" value={brand.groupsCompeted ? `${brand.groupsLowest}/${brand.groupsCompeted}` : "—"} sub="comparisons" />
              <Stat label="In stock" value={formatPct(brand.inStockShare)} sub={brand.discountedShare !== null ? `${formatPct(brand.discountedShare)} discounted` : undefined} />
            </dl>
            <h3 className="mt-6 text-sm font-semibold">Products</h3>
            <ul className="mt-2 space-y-1">
              {brand.products.map((p) => (
                <li key={p.id}>
                  <Link href={`/products/${p.id}`} className="-mx-2 flex items-center gap-3 rounded-[10px] px-2 py-1.5 hover:bg-[var(--hairline)]">
                    <ProductImage src={p.imageUrl} alt="" size={32} rounded={8} />
                    <span className="min-w-0 flex-1 truncate text-sm">{p.title.startsWith(brand.name) ? p.title.slice(brand.name.length).replace(/^[\s,·:-]+/, "") : p.title}</span>
                    <MarketplaceTag code={p.marketplace} />
                    <span className="text-xs text-ink-3">{p.variants} var.</span>
                  </Link>
                </li>
              ))}
            </ul>
            <h3 className="mt-6 text-sm font-semibold">Changes in the last 7 days</h3>
            <ul className="mt-2 space-y-1">
              {brand.changes.length === 0 && <li className="text-sm text-ink-3">No observed changes.</li>}
              {brand.changes.map((c) => (
                <li key={c.variantId}>
                  <Link href={`/products/${c.familyId}?variant=${c.variantId}`} className="-mx-2 flex items-center gap-3 rounded-[10px] px-2 py-1.5 text-sm hover:bg-[var(--hairline)]">
                    <span className="min-w-0 flex-1 truncate">{c.title.replace(brand.name, "").split(",")[0]} · {c.label}</span>
                    <span className="num text-xs text-ink-3">{formatMoney(c.from, c.currency)} → {formatMoney(c.to, c.currency)}</span>
                    <Delta ratio={pctChange(c.from, c.to)} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card p-5">
          <SectionHeader title="Brand vs brand" description="Tracked listings only" />
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm font-medium">{ref?.name ?? stats[0]!.name}</span>
            <span className="text-xs text-ink-3">vs</span>
            <Select ariaLabel="Compare with" size="sm" value={vs} onValueChange={setVs} options={stats.filter((s) => s.name !== (ref?.name ?? stats[0]!.name)).map((s) => ({ value: s.name, label: s.name }))} />
          </div>
          {other && (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-wide text-ink-3">
                  <th className="pb-2 font-semibold">Metric</th>
                  {[ref ?? stats[0]!, other].map((b) => (
                    <th key={b.name} className="w-[30%] pb-2 pl-3 text-right align-bottom text-xs font-medium normal-case tracking-normal text-ink-2">
                      <span className="inline-flex items-start justify-end gap-1.5 text-balance"><span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: colors.get(b.name) ?? OTHER_VAR }} />{b.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Comparable listings", (b: BrandData) => String(b.comparableListings)],
                  ["Median premium vs others", (b: BrandData) => (b.medianPremium === null ? "—" : formatPct(b.medianPremium, { signed: true }))],
                  ["Lowest price in groups", (b: BrandData) => (b.groupsCompeted ? `${b.groupsLowest} of ${b.groupsCompeted}` : "—")],
                  ["Listings discounted", (b: BrandData) => (b.discountedShare === null ? "—" : formatPct(b.discountedShare))],
                  ["In stock", (b: BrandData) => formatPct(b.inStockShare)],
                  ["Avg change · 7d", (b: BrandData) => (b.avgChange7d === null ? "—" : formatPct(b.avgChange7d, { signed: true }))],
                  ["Avg change · 30d", (b: BrandData) => (b.avgChange30d === null ? "—" : formatPct(b.avgChange30d, { signed: true }))],
                  ["Segment", (b: BrandData) => b.segment?.label ?? "—"],
                ].map(([label, fn]) => (
                  <tr key={label as string} className="hairline-t">
                    <td className="py-2.5 text-ink-2">{label as string}</td>
                    <td className="num py-2.5 text-right">{(fn as (b: BrandData) => string)(ref ?? stats[0]!)}</td>
                    <td className="num py-2.5 text-right">{(fn as (b: BrandData) => string)(other)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Link href="/reports?type=brand_comparison" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-accent">Export brand comparison <ArrowRight className="size-3" /></Link>
        </section>
      </div>
    </div>
  );
}

/** Brands grouped by k-means over premium, discount share and price movement. Hidden until there's enough overlap to cluster. */
function Segments({ stats, colors, onPick }: { stats: BrandData[]; colors: Map<string, string>; onPick: (name: string) => void }) {
  const groups = [...new Map(stats.filter((s) => s.segment).map((s) => [s.segment!.cluster, s.segment!.label])).entries()].map(([cluster, label]) => ({ cluster, label, members: stats.filter((s) => s.segment?.cluster === cluster) }));
  if (groups.length < 2) return null;
  const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : null);
  // Only mention discount share when it actually differs between segments (e.g. India lists below MRP everywhere).
  const discounts = groups.map((g) => med(g.members.map((m) => m.discountedShare ?? 0)));
  const discountInformative = new Set(discounts.map((d) => (d === null ? "n" : d.toFixed(2)))).size > 1;
  return (
    <section className="card p-5">
      <SectionHeader title="Positioning segments" description="Brands that price alike, found by clustering — tracked listings only" />
      <div className={cn("mt-4 grid gap-3", groups.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {groups.map((g, gi) => {
          const premium = med(g.members.map((m) => m.medianPremium ?? 0));
          const discounted = med(g.members.map((m) => m.discountedShare ?? 0));
          return (
            <motion.div key={g.cluster} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: staggerDelay(gi, 0.06) }} className="rounded-[14px] bg-surface-2 p-4 shadow-[var(--ring-inset)]">
              <div className="text-sm font-semibold tracking-tight">{g.label}</div>
              <div className="num mt-0.5 text-2xs text-ink-3">
                {premium !== null && `${formatPct(premium, { signed: true })} vs peers`}
                {discountInformative && discounted !== null && ` · ${formatPct(discounted)} discounted`}
              </div>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {g.members.map((m) => (
                  <li key={m.name}>
                    <button onClick={() => onPick(m.name)} className="flex h-7 items-center gap-1.5 rounded-full bg-surface px-2.5 text-xs font-medium shadow-[var(--shadow-xs),var(--ring-inset)] transition-[transform,box-shadow] hover:shadow-[var(--shadow-sm),var(--ring-inset)] active:scale-[0.97]">
                      <span className="size-2 rounded-full" style={{ background: colors.get(m.name) ?? OTHER_VAR }} />
                      {m.name}
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          );
        })}
      </div>
      <p className="mt-3 text-2xs text-ink-3">Method: k-means (seeded, k ≤ 3) on standardized median premium (weighted ×2), share of listings discounted and mean 30-day price movement. Brands without a comparison overlap aren’t clustered.</p>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="num mt-0.5 text-lg font-semibold tracking-tight">{value}</dd>
      {sub && <dd className="text-2xs text-ink-3">{sub}</dd>}
    </div>
  );
}
