"use client";

import { motion } from "motion/react";
import { ArrowRight, BarChart3, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { formatMoney, formatPct } from "@/lib/money";
import { NORMALIZATION_BASES, type NormalizationBasis } from "@/lib/quantity";
import { spring, staggerDelay } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { ProductImage } from "../ui/product-image";
import { SimulatedBadge } from "../ui/status";
import { toast } from "sonner";

interface Card {
  id: string;
  name: string;
  description: string | null;
  basis: string;
  currency: string | null;
  items: number;
  comparable: number;
  brands: string[];
  images: (string | null)[];
  cheapest: { name: string; unit: number | null; role: string } | null;
  referencePremium: number | null;
  headline: string | null;
  simulated: boolean;
  bars: { id: string; unit: number; role: string }[];
  managed: boolean;
}

export function ComparisonsIndex({ cards }: { cards: Card[] }) {
  const params = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    if (params.get("new") === "1") {
      toast("Select listings to compare", { description: "Choose variants in Products — they collect in the comparison tray." });
      router.replace("/products");
    }
  }, [params, router]);

  if (!cards.length) {
    return (
      <EmptyState
        icon={<BarChart3 />}
        title="No comparisons yet"
        description="Select two or more listings in Products, then press Compare. Aisle ranks them per gram, per tablet or per item — whichever they share."
        action={<Button variant="primary" onClick={() => router.push("/products")}><Plus className="size-4" /> Choose products</Button>}
      />
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((c, i) => {
        const max = Math.max(...c.bars.map((b) => b.unit), 1);
        const min = Math.min(...c.bars.map((b) => b.unit), max);
        return (
          <motion.li key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: staggerDelay(i, 0.05) }}>
            <Link href={`/comparisons/${c.id}`} className="group card flex h-full flex-col p-5 outline-none transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md),var(--ring-inset)] focus-visible:shadow-[0_0_0_2px_var(--focus)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-md font-semibold tracking-tight">{c.name}</h3>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {c.managed && <span className="font-medium text-accent">Auto · </span>}
                    {c.items} listings · {c.brands.length} brands · {NORMALIZATION_BASES[c.basis as NormalizationBasis]?.long ?? c.basis}
                  </p>
                </div>
                {c.simulated && <SimulatedBadge compact />}
              </div>
              {/* Mini ranked bar strip — relative unit price, reference highlighted */}
              <div className="mt-4 flex h-14 items-end gap-1" aria-hidden>
                {c.bars.map((b) => (
                  <div key={b.id} className={cn("flex-1 rounded-t-[4px] transition-colors", b.role === "reference" ? "bg-[var(--series-1)]" : "bg-[var(--line-strong)] group-hover:bg-[color-mix(in_srgb,var(--ink)_20%,transparent)]")} style={{ height: `${max === min ? 60 : 30 + ((b.unit - min) / (max - min)) * 70}%` }} />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-2xs text-ink-4"><span>cheapest</span><span>most expensive</span></div>
              {c.headline && <p className="mt-3 line-clamp-2 text-sm text-ink-2">{c.headline}</p>}
              <div className="mt-auto flex items-center justify-between pt-4">
                <div className="flex -space-x-2">
                  {c.images.map((src, j) => (
                    <div key={j} className="rounded-[9px] ring-2 ring-surface">
                      <ProductImage src={src} alt="" size={28} rounded={8} />
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {c.referencePremium !== null && <Badge tone={c.referencePremium > 0.05 ? "up" : c.referencePremium < -0.02 ? "down" : "neutral"} size="xs">ref {formatPct(c.referencePremium, { signed: true })} vs median</Badge>}
                  {c.cheapest?.unit != null && <span className="num text-xs text-ink-3">from {formatMoney(c.cheapest.unit, c.currency ?? "INR", undefined, { trimZeros: false })}{NORMALIZATION_BASES[c.basis as NormalizationBasis]?.label}</span>}
                  <ArrowRight className="size-4 text-ink-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </Link>
          </motion.li>
        );
      })}
    </ul>
  );
}
