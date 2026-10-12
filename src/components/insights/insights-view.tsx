"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, BarChart3, ChevronDown, CircleSlash, Layers, Repeat, Sparkles, TrendingDown, TrendingUp, Waves, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/freshness";
import { formatMoney, formatPct } from "@/lib/money";
import type { Insight } from "@/server/insights/engine";
import { spring, staggerDelay } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Segmented } from "../ui/segmented";
import { SimulatedBadge } from "../ui/status";

const ICONS: Record<string, typeof Sparkles> = { competitor_cut: TrendingDown, competitor_raise: TrendingUp, observed_low: TrendingDown, brand_premium: Layers, reference_lost_lead: BarChart3, volatility_up: Waves, unit_economics: Sparkles, competitor_unavailable: CircleSlash, discount_ended: AlertTriangle, unusual_move: Zap, price_trend: TrendingUp, promo_cycle: Repeat };
const KIND_LABEL: Record<string, string> = { competitor_cut: "Competitor move", competitor_raise: "Competitor move", observed_low: "Observed low", brand_premium: "Positioning", reference_lost_lead: "Leadership", volatility_up: "Volatility", unit_economics: "Unit economics", competitor_unavailable: "Availability", discount_ended: "Promotion", unusual_move: "Unusual move", price_trend: "Trend", promo_cycle: "Promotion cycle" };
const PATTERN_KINDS = ["unusual_move", "price_trend", "promo_cycle"];

/** Human labels and formats for the evidence panel — never raw minor units or ISO strings. */
const METRIC_LABEL: Record<string, string> = { from: "Before", to: "After", ratio: "Change", price: "Price now", previousLow: "Previous low", best: "Best unit price", worst: "Highest unit price", saving: "Saving", medianPremium: "Median premium", listings: "Listings", recentChanges: "Changes · last 14 days", priorChanges: "Changes · prior 14 days", z: "Robust z-score", unusualZ: "Robust z-score", weeklyRatio: "Trend per week", r2: "Fit (R²)", changes: "Price changes", periodDays: "Cycle length", acf: "Autocorrelation", episodes: "Discount episodes", lastSeen: "Lowest seen" };
const MONEY_KEYS = new Set(["from", "to", "price", "previousLow", "best", "worst", "lastSeen"]);
const PCT_KEYS = new Set(["ratio", "saving", "medianPremium", "weeklyRatio"]);
function formatMetric(key: string, v: number | string | null, currency: string | null | undefined) {
  if (v === null || v === undefined) return "—";
  if (typeof v !== "number") return String(v);
  if (MONEY_KEYS.has(key) && currency) return formatMoney(v, currency, undefined, { trimZeros: !["best", "worst"].includes(key) });
  if (PCT_KEYS.has(key)) return formatPct(v, { signed: key === "ratio" || key === "weeklyRatio" });
  if (key === "periodDays") return `${v} days`;
  if (key === "r2" || key === "acf") return v.toFixed(2);
  if (key === "z" || key === "unusualZ") return v.toFixed(1);
  return v.toLocaleString();
}
/** Evidence lines carry ISO timestamps for auditability; show them in the reader's locale. */
function humanizeEvidence(line: string) {
  return line
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (iso) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))
    .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }));
}

export function InsightsView({ insights }: { insights: Insight[] }) {
  const [filter, setFilter] = useState<"all" | "competitors" | "positioning" | "patterns" | "availability">("all");
  const [open, setOpen] = useState<string | null>(insights[0]?.id ?? null);
  const [summary, setSummary] = useState<{ text: string | null; model: string | null; source?: "ai" | "built-in"; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const shown = insights.filter((i) => filter === "all" || (filter === "competitors" && ["competitor_cut", "competitor_raise", "volatility_up", "discount_ended"].includes(i.kind)) || (filter === "positioning" && ["brand_premium", "reference_lost_lead", "unit_economics", "observed_low"].includes(i.kind)) || (filter === "patterns" && PATTERN_KINDS.includes(i.kind)) || (filter === "availability" && i.kind === "competitor_unavailable"));

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
        <Segmented ariaLabel="Filter insights" size="sm" value={filter} onChange={setFilter} options={[{ value: "all", label: `All (${insights.length})` }, { value: "competitors", label: "Competitors" }, { value: "positioning", label: "Positioning" }, { value: "patterns", label: "Patterns" }, { value: "availability", label: "Availability" }]} />
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
          const Icon = ins.kind === "price_trend" && Number(ins.metrics.weeklyRatio) < 0 ? TrendingDown : (ICONS[ins.kind] ?? Sparkles);
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
                        <ul className="mt-1.5 space-y-1 text-xs text-ink-2">{ins.evidence.map((e, j) => <li key={j} suppressHydrationWarning>• {humanizeEvidence(e)}</li>)}</ul>
                      </div>
                      <div>
                        <div className="eyebrow">Metrics</div>
                        <dl className="mt-1.5 space-y-0.5 text-xs">
                          {Object.entries(ins.metrics).map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-3"><dt className="text-ink-3">{METRIC_LABEL[k] ?? k}</dt><dd className="num text-ink">{formatMetric(k, v, ins.currency)}</dd></div>
                          ))}
                        </dl>
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
