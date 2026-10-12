"use client";

import { motion } from "motion/react";
import { ArrowRight, Info } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
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
  products: { id: string; title: string; imageUrl: string | null; variants: number; marketplace: string }[];
  changes: { variantId: string; familyId: string; label: string; title: string; from: number; to: number; currency: string }[];
}

export function BrandsView({ stats, brands, initialBrand }: { stats: BrandData[]; brands: { id: string; name: string; isReference: boolean }[]; initialBrand: string | null }) {
  const router = useRouter();
  const [active, setActive] = useState<string | null>(initialBrand ?? stats[0]?.name ?? null);
  const ref = stats.find((s) => s.isReference);
  const [vs, setVs] = useState<string>(stats.find((s) => !s.isReference)?.name ?? "");
  const colors = useMemo(() => brandColorMap(stats.map((s) => ({ name: s.name, isReference: s.isReference }))), [stats]);
  const brand = stats.find((s) => s.name === active) ?? null;
  const other = stats.find((s) => s.name === vs) ?? null;

  if (!stats.length) return <EmptyState icon={<Tag />} title="No brands yet" description="Brands appear as you add products. Mark one as your reference to see how competitors price against it." />;

  async function setReference(id: string | null) {
    await api("/api/brands/reference", { method: "POST", body: { brandId: id } });
    toast.success("Reference brand updated");
    router.refresh();
  }

  const maxAbs = Math.max(0.05, ...stats.map((s) => Math.abs(s.medianPremium ?? 0)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-surface-2 px-4 py-3 text-sm shadow-[var(--ring-inset)]">
        <Info className="size-4 text-ink-3" />
        <span className="text-ink-2">Reference brand</span>
        <Select ariaLabel="Reference brand" size="sm" value={brands.find((b) => b.isReference)?.id ?? "none"} onValueChange={(v) => setReference(v === "none" ? null : v)} options={[{ value: "none", label: "None" }, ...brands.map((b) => ({ value: b.id, label: b.name }))]} />
        <span className="text-xs text-ink-3">Competitive premiums and “undercut” alerts are measured against this brand.</span>
      </div>

      {/* Premium chart — diverging, neutral midpoint */}
      <section className="card p-5">
        <SectionHeader title="Price position" description="Median unit-price premium vs. other brands in the same comparison groups" />
        <ul className="mt-4 space-y-2.5">
          {stats.map((s, i) => (
            <motion.li key={s.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: staggerDelay(i) }}>
              <button onClick={() => setActive(s.name)} className={cn("grid w-full grid-cols-[160px_1fr_72px] items-center gap-3 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--hairline)]", active === s.name && "bg-accent-softer")}>
                <span className="flex items-center gap-2 truncate text-sm font-medium">
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
        <div className="mt-2 grid grid-cols-[160px_1fr_72px] gap-3 px-2 text-2xs text-ink-3"><span /><span className="flex justify-between"><span>▼ cheaper</span><span>pricier ▲</span></span><span /></div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        {brand && (
          <section className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight">{brand.name}</h2>
                  {brand.isReference && <Badge tone="accent" size="xs">Reference</Badge>}
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
                    <span className="min-w-0 flex-1 truncate text-sm">{p.title}</span>
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
                  <th className="max-w-[110px] truncate pb-2 pl-3 text-right font-semibold">{ref?.name ?? stats[0]!.name}</th>
                  <th className="max-w-[110px] truncate pb-2 pl-3 text-right font-semibold">{other.name}</th>
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="num mt-0.5 text-lg font-semibold tracking-tight">{value}</dd>
      {sub && <dd className="text-2xs text-ink-3">{sub}</dd>}
    </div>
  );
}
