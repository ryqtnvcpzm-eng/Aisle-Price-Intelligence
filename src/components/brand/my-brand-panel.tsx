"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronDown, Layers, ShieldCheck, Tag } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { unmatchedCopy, type Unmatched } from "@/lib/cohorts";
import { cn } from "@/lib/cn";
import { MARKETPLACES, isMarketplaceCode } from "@/lib/marketplaces";
import { NORMALIZATION_BASES, isNormalizationBasis } from "@/lib/quantity";
import { spring, staggerDelay } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ChooseBrandDialog } from "./choose-brand-dialog";

export interface MyBrandData {
  brand: { id: string; name: string } | null;
  groups: { id: string; name: string; basis: string; marketplace: string | null; items: number }[];
  unmatched: Unmatched[];
  protectionEnabled: boolean;
}

/** Brands page → "My Brand": the brand, its managed comparisons, and what isn't matched yet (with why). */
export function MyBrandPanel({ data }: { data: MyBrandData }) {
  const [choosing, setChoosing] = useState(false);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const { brand } = data;

  if (!brand) {
    return (
      <section className="card flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[13px] bg-accent-soft text-accent">
          <Tag className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="eyebrow">My brand</div>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight">Which brand is yours?</h2>
          <p className="mt-0.5 text-sm text-ink-2">Choose it once and Aisle keeps a “vs Market” comparison for every category and unit you sell in.</p>
        </div>
        <Button variant="primary" onClick={() => setChoosing(true)}>Choose your brand</Button>
        <ChooseBrandDialog key={String(choosing)} open={choosing} onOpenChange={setChoosing} current={null} />
      </section>
    );
  }

  const prefix = `${brand.name} vs Market · `;
  return (
    <section className="card p-5" aria-labelledby="my-brand-title">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="eyebrow">My brand</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <h2 id="my-brand-title" className="text-xl font-semibold tracking-tight">{brand.name}</h2>
            {data.protectionEnabled ? (
              <Badge tone="good" size="xs"><ShieldCheck className="size-3" /> Protected</Badge>
            ) : (
              <Link href="/alerts#protect" className="text-xs font-medium text-accent">Turn on Protect My Brand</Link>
            )}
          </div>
          <p className="mt-0.5 text-sm text-ink-3">
            {data.groups.length ? `Compared with the market in ${data.groups.length} categor${data.groups.length === 1 ? "y" : "ies"} — kept in sync as you add products.` : "No comparisons yet — add a competitor in one of your categories."}
          </p>
        </div>
        <Button size="sm" onClick={() => setChoosing(true)}>Change…</Button>
      </div>

      {data.groups.length > 0 && (
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {data.groups.map((g, i) => {
            const rest = g.name.startsWith(prefix) ? g.name.slice(prefix.length) : g.name;
            const [category, ...more] = rest.split(" · ");
            return (
              <motion.li key={g.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: staggerDelay(i) }}>
                <Link href={`/comparisons/${g.id}`} className="group flex items-center gap-3 rounded-[12px] bg-surface-2 px-3.5 py-3 shadow-[var(--ring-inset)] transition-colors hover:bg-accent-softer">
                  <Layers className="size-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{category}</span>
                    <span className="num block text-xs text-ink-3">
                      {isNormalizationBasis(g.basis) ? NORMALIZATION_BASES[g.basis].long : g.basis} · {g.items} listing{g.items === 1 ? "" : "s"}
                      {more.length && g.marketplace && isMarketplaceCode(g.marketplace) ? ` · ${MARKETPLACES[g.marketplace].flag}` : ""}
                    </span>
                  </span>
                  <ArrowRight className="size-3.5 text-ink-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </motion.li>
            );
          })}
        </ul>
      )}

      {data.unmatched.length > 0 && (
        <div className="mt-4 rounded-[12px] bg-surface-2 shadow-[var(--ring-inset)]">
          <button onClick={() => setShowUnmatched((v) => !v)} aria-expanded={showUnmatched} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm">
            <span className="font-medium">Not yet matched</span>
            <span className="num text-xs text-ink-3">{data.unmatched.length}</span>
            <span className="ml-auto hidden text-xs text-ink-3 sm:inline">Listings Aisle can’t compare fairly yet</span>
            <motion.span animate={{ rotate: showUnmatched ? 180 : 0 }} transition={spring.snappy} className="ml-auto sm:ml-0">
              <ChevronDown className="size-4 text-ink-3" />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {showUnmatched && (
              <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.layout} className="overflow-hidden px-1.5 pb-1.5">
                {data.unmatched.map((u) => (
                  <li key={u.variantId}>
                    <Link href={`/products/${u.familyId}?variant=${u.variantId}`} className="flex items-start gap-3 rounded-[9px] px-2 py-2 hover:bg-[var(--hairline)]">
                      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", u.reason === "no_quantity" ? "bg-warn" : "bg-ink-4")} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {u.brandName ?? "Unbranded"} · {u.familyTitle.replace(u.brandName ?? "", "").split(/[,(]/)[0]!.trim()} · {u.label}
                        </span>
                        <span className="block text-xs text-ink-3">{unmatchedCopy(u, brand.name)}</span>
                      </span>
                      {u.isReference && <Badge tone="accent" size="xs">Yours</Badge>}
                    </Link>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
      <ChooseBrandDialog key={String(choosing)} open={choosing} onOpenChange={setChoosing} current={brand} />
    </section>
  );
}
