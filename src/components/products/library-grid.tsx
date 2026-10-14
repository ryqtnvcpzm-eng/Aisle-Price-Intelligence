"use client";

import { motion } from "motion/react";
import { Check, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, ViewTransition } from "react";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import type { FamilySummary } from "@/server/catalog/queries";
import { spring, staggerDelay } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Delta } from "../ui/price";
import { ProductImage } from "../ui/product-image";
import { CapturedBadge, Freshness, MarketplaceTag, SimulatedBadge } from "../ui/status";
import { familyStats } from "./library-utils";

export function LibraryGrid({ families, selected, onToggle, highlight }: { families: FamilySummary[]; selected: Set<string>; onToggle: (id: string) => void; highlight: Set<string> }) {
  return (
    <motion.ul layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {families.map((f, i) => (
        <Card key={f.familyId} f={f} index={i} selected={selected.has(f.familyId)} anySelected={selected.size > 0} onToggle={onToggle} isNew={highlight.has(f.familyId)} />
      ))}
    </motion.ul>
  );
}

const Card = memo(function Card({ f, index, selected, anySelected, onToggle, isNew }: { f: FamilySummary; index: number; selected: boolean; anySelected: boolean; onToggle: (id: string) => void; isNew: boolean }) {
  const router = useRouter();
  const s = familyStats(f);
  // Provenance of the prices on the card: captured variants say so; Simulated only while some price still is.
  const visible = f.variants.filter((v) => !v.hidden);
  const captured = visible.filter((v) => v.priceSource === "user-capture");
  const lastCapture = captured.reduce<string | null>((a, v) => (v.lastObservedAt && (!a || v.lastObservedAt > a) ? v.lastObservedAt : a), null);
  const anySimulated = visible.length ? visible.some((v) => v.priceSource !== "user-capture" && v.priceIsSimulated) : f.isSimulated;
  const priceText = s.min === null ? "No price" : s.min === s.max ? formatMoney(s.min, s.currency ?? "INR") : `${formatMoney(s.min, s.currency ?? "INR")} – ${formatMoney(s.max, s.currency ?? "INR")}`;
  return (
    <motion.li
      layout
      initial={isNew ? { opacity: 0, scale: 0.92, y: 16 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ ...spring.layout, delay: isNew ? 0.15 : staggerDelay(index, 0.03) }}
      className="relative"
    >
      <Link
        href={`/products/${f.familyId}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || anySelected) {
            e.preventDefault();
            onToggle(f.familyId);
          }
        }}
        onMouseEnter={() => router.prefetch(`/products/${f.familyId}`)}
        className={cn(
          "group flex h-full flex-col rounded-[18px] bg-surface p-3 outline-none transition-[box-shadow,transform] duration-200 ease-out",
          "shadow-[var(--shadow-sm),var(--ring-inset)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md),var(--ring-inset)] active:translate-y-0 active:scale-[0.99] focus-visible:shadow-[0_0_0_2px_var(--focus)]",
          selected && "shadow-[0_0_0_2px_var(--accent),var(--shadow-md)] hover:shadow-[0_0_0_2px_var(--accent),var(--shadow-md)]",
          isNew && "shadow-[0_0_0_2px_var(--good),var(--shadow-md)]",
        )}
      >
        <div className="relative aspect-[16/10] overflow-hidden rounded-[13px] bg-[#f4f4f6] sm:aspect-[5/4] dark:bg-[#e6e6ea]">
          <ViewTransition name={`product-${f.familyId}`} share="morph" default="none">
            <div className="h-full w-full">
              <ProductImage src={f.imageUrl} alt={f.title} size="fill" rounded={13} className="h-full w-full transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
            </div>
          </ViewTransition>
          <div className="absolute left-2 top-2 flex gap-1">
            {captured.length > 0 && <CapturedBadge compact onImage at={lastCapture} />}
            {anySimulated && <SimulatedBadge compact onImage />}
            {isNew && <Badge tone="good" size="xs">New</Badge>}
          </div>
        </div>
        <div className="flex flex-1 flex-col px-1 pb-0.5 pt-3">
          <div className="flex items-center gap-1.5 text-xs">
            {f.favorite && <Star className="size-3 shrink-0 fill-[#f5a623] text-[#f5a623]" aria-label="Favorite" />}
            <span className="truncate font-medium text-ink-2">{f.brandName ?? "Unbranded"}</span>
            {f.isReferenceBrand && <Badge tone="accent" size="xs">Ref</Badge>}
            <MarketplaceTag code={f.marketplace} className="ml-auto shrink-0 [&>span:last-child]:hidden xl:[&>span:last-child]:inline" />
          </div>
          <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-snug tracking-tight">{f.title.replace(f.brandName ?? "", "").trim()}</h3>
          <div className="mt-auto pt-3">
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="num text-md font-semibold tracking-tight">{priceText}</div>
                <div className="text-2xs text-ink-3">
                  {f.variants.length} variant{f.variants.length === 1 ? "" : "s"}
                  {s.best && <span> · best <span className="num text-ink-2">{formatMoney(s.best.unit, s.currency ?? "INR", undefined, { trimZeros: false })}{s.best.label}</span></span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Delta ratio={s.change7d} title="Average change over 7 days" />
                <span className="text-2xs text-ink-4">7d</span>
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between pt-2.5 hairline-t">
              <Freshness state={s.freshness} />
              {s.oos > 0 ? <span className="text-2xs font-medium text-bad">{s.oos} unavailable</span> : <span className="text-2xs text-ink-3">{s.inStock} in stock</span>}
            </div>
          </div>
        </div>
      </Link>
      <button
        onClick={() => onToggle(f.familyId)}
        aria-pressed={selected}
        aria-label={selected ? `Deselect ${f.title}` : `Select ${f.title}`}
        className={cn(
          "absolute right-5 top-5 flex size-6 items-center justify-center rounded-full transition-all duration-150",
          selected ? "scale-100 bg-accent text-white opacity-100" : "bg-white/90 text-transparent opacity-0 shadow-[0_1px_3px_rgba(0,0,0,0.2),inset_0_0_0_1.5px_rgba(0,0,0,0.15)] focus-visible:opacity-100 [li:hover_&]:opacity-100",
        )}
      >
        <Check className="size-3.5" strokeWidth={3} />
      </button>
    </motion.li>
  );
});
