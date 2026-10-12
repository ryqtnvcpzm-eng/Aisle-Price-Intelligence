"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, BarChart3, ChevronDown, CircleSlash, Layers, Sparkles, TrendingDown, TrendingUp, Waves } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/freshness";
import { formatPct } from "@/lib/money";
import type { Insight } from "@/server/insights/engine";
import { spring, staggerDelay } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Segmented } from "../ui/segmented";
import { SimulatedBadge } from "../ui/status";

const ICONS: Record<string, typeof Sparkles> = { competitor_cut: TrendingDown, competitor_raise: TrendingUp, observed_low: TrendingDown, brand_premium: Layers, reference_lost_lead: BarChart3, volatility_up: Waves, unit_economics: Sparkles, competitor_unavailable: CircleSlash, discount_ended: AlertTriangle };
const KIND_LABEL: Record<string, string> = { competitor_cut: "Competitor move", competitor_raise: "Competitor move", observed_low: "Observed low", brand_premium: "Positioning", reference_lost_lead: "Leadership", volatility_up: "Volatility", unit_economics: "Unit economics", competitor_unavailable: "Availability", discount_ended: "Promotion" };

export function InsightsView({ insights }: { insights: Insight[] }) {
  const [filter, setFilter] = useState<"all" | "competitors" | "positioning" | "availability">("all");
  const [open, setOpen] = useState<string | null>(insights[0]?.id ?? null);
  const [summary, setSummary] = useState<{ text: string | null; model: string | null; source?: "ai" | "built-in"; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const shown = insights.filter((i) => filter === "all" || (filter === "competitors" && ["competitor_cut", "competitor_raise", "volatility_up", "discount_ended"].includes(i.kind)) || (filter === "positioning" && ["brand_premium", "reference_lost_lead", "unit_economics", "observed_low"].includes(i.kind)) || (filter === "availability" && i.kind === "competitor_unavailable"));

  async function explain() {
    setLoading(true);
    try {
      const r = await api<{ summary: string | null; model: string | null; source: "ai" | "built-in" }>("/api/insights/explain", { method: "POST" });
      setSummary({ text: r.summary, model: r.model, source: r.source });
    } catch (e) {
      setSummary({ text: null, model: null, error: e instanceof ApiError ? e.message : "Couldn't generate a summary." });
    } finally {
      setLoading(false);
    }
  }

  if (!insights.length) return <EmptyState icon={<Sparkles />} title="Nothing notable yet" description="Insights appear once Aisle has a few days of observations across comparable listings." />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented ariaLabel="Filter insights" size="sm" value={filter} onChange={setFilter} options={[{ value: "all", label: `All (${insights.length})` }, { value: "competitors", label: "Competitors" }, { value: "positioning", label: "Positioning" }, { value: "availability", label: "Availability" }]} />
        <Button className="ml-auto" size="sm" variant="tinted" loading={loading} onClick={explain}>
          <Sparkles className="size-3.5" /> Brief me
        </Button>
      </div>

      <AnimatePresence>
        {summary && (
          <motion.section initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-accent" /> Morning briefing</div>
            {summary.error ? <p className="mt-2 text-sm text-bad">{summary.error}</p> : <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{summary.text ?? "No summary available."}</p>}
            <p className="mt-3 text-2xs text-ink-3">{summary.source === "ai" ? `Written by ${summary.model ?? "an AI model"} from the verified findings below only — it isn’t given raw data and can’t add prices or causes.` : "Assembled by Aisle from the verified findings below — no external AI service is used."}</p>
          </motion.section>
        )}
      </AnimatePresence>

      <ul className="space-y-2">
        {shown.map((ins, i) => {
          const Icon = ICONS[ins.kind] ?? Sparkles;
          const isOpen = open === ins.id;
          return (
            <motion.li key={ins.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: staggerDelay(i) }} className="card overflow-hidden">
              <button onClick={() => setOpen(isOpen ? null : ins.id)} className="flex w-full items-start gap-4 px-5 py-4 text-left" aria-expanded={isOpen}>
                <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[11px]", ins.tone === "warning" ? "bg-warn-soft text-warn" : ins.tone === "negative" ? "bg-bad-soft text-bad" : ins.tone === "positive" ? "bg-good-soft text-good" : "bg-accent-soft text-accent")}>
                  <Icon className="size-[18px]" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-2xs text-ink-3">
                    <span className="font-semibold uppercase tracking-wide">{KIND_LABEL[ins.kind]}</span>
                    <span>· {ins.period}</span>
                    <span>· {relativeTime(ins.at)}</span>
                    {ins.isSimulated && <SimulatedBadge compact />}
                  </span>
                  <span className="mt-1 block text-md font-semibold leading-snug tracking-tight">{ins.headline}</span>
                  <span className="mt-1 block text-sm text-ink-2">{ins.explanation}</span>
                </span>
                <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={spring.snappy} className="mt-2 text-ink-3"><ChevronDown className="size-4" /></motion.span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.layout} className="overflow-hidden">
                    <div className="grid gap-4 px-5 pb-5 pl-[76px] md:grid-cols-3">
                      <div>
                        <div className="eyebrow">Evidence</div>
                        <ul className="mt-1.5 space-y-1 text-xs text-ink-2">{ins.evidence.map((e, j) => <li key={j}>• {e}</li>)}</ul>
                      </div>
                      <div>
                        <div className="eyebrow">Metrics</div>
                        <dl className="mt-1.5 space-y-0.5 text-xs">
                          {Object.entries(ins.metrics).map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-3"><dt className="text-ink-3">{k}</dt><dd className="num text-ink">{typeof v === "number" && Math.abs(v) < 5 && !Number.isInteger(v) ? formatPct(v) : String(v ?? "—")}</dd></div>
                          ))}
                        </dl>
                        <p className="mt-1.5 text-2xs text-ink-4">Amounts in minor units (e.g. paise).</p>
                      </div>
                      <div>
                        <div className="eyebrow">Coverage</div>
                        <p className="mt-1.5 text-xs text-ink-2">{ins.coverage.observations} observations{ins.coverage.share !== null ? `, ${formatPct(ins.coverage.share)} of the window covered` : ""}.</p>
                        <div className="mt-2 flex flex-wrap gap-1">{ins.items.map((it) => <Badge key={it.variantId} size="xs">{it.name}</Badge>)}</div>
                        <Link href={ins.href} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent">Open the data <ArrowRight className="size-3" /></Link>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.li>
          );
        })}
      </ul>
      <p className="text-center text-xs text-ink-3">Insights describe what was observed. Aisle doesn’t speculate about why a competitor changed a price.</p>
    </div>
  );
}
