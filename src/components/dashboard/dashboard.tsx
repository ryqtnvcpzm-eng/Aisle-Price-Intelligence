"use client";

import { motion } from "motion/react";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Bell, Boxes, CircleSlash, Clock, Package, RefreshCw, Repeat, Sparkles, Tag, TrendingDown, TrendingUp, Zap } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/freshness";
import { formatMoney, formatPct } from "@/lib/money";
import type { VariantRow } from "@/server/catalog/queries";
import type { Insight } from "@/server/insights/engine";
import { IndexTrendChart, type IndexPoint } from "../charts/index-trend-chart";
import { spring, staggerDelay } from "../motion/tokens";
import { useImport } from "../import/import-context";
import { AnimatedNumber } from "../ui/animated-number";
import { Badge } from "../ui/badge";
import { Button, ButtonLink } from "../ui/button";
import { EmptyState, SectionHeader } from "../ui/empty-state";
import { Delta } from "../ui/price";
import { ProductImage } from "../ui/product-image";
import { SimulatedBadge } from "../ui/status";
import { useApp } from "../shell/app-context";

interface Mover {
  variant: VariantRow;
  from: number;
  to: number;
  ratio: number;
}
interface ActivityRow {
  id: string;
  kind: string;
  message: string;
  createdAt: string;
  isSimulated: boolean;
  entityType: string | null;
  entityId: string | null;
}
interface AlertEventRow {
  id: string;
  headline: string;
  detail: string | null;
  firedAt: string;
  isSimulated: boolean;
}
export interface DashboardData {
  kpis: { products: number; variants: number; monitored: number; paused: number; competitorBrands: number; changes24h: number; activeRules: number; alerts24h: number; freshness: Record<string, number>; coverage: number | null };
  movers: { down: Mover[]; up: Mover[] };
  attention: { variant: VariantRow; reason: string }[];
  trend: IndexPoint[];
  activity: ActivityRow[];
  recentAlerts: AlertEventRow[];
  brands: { name: string; isReference: boolean; variants: number; avgChange7d: number | null; inStockShare: number }[];
  lastRefreshAt: string | null;
  isSimulated: boolean;
}

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date()));
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const appear = (i: number) => ({ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { ...spring.gentle, delay: staggerDelay(i, 0.06) } });

export function Dashboard({ data, insights, userName, renderedAt }: { data: DashboardData; insights: Insight[]; userName: string; renderedAt: string }) {
  const app = useApp();
  const importer = useImport();
  const k = data.kpis;
  const firstName = userName.split(" ")[0];
  const refBrand = data.brands.find((b) => b.isReference)?.name;

  const summary = useMemo(() => {
    const parts: string[] = [];
    parts.push(k.changes24h ? `${k.changes24h} price change${k.changes24h === 1 ? "" : "s"} in the last 24 hours across ${k.variants} monitored variants.` : `No price changes observed in the last 24 hours across ${k.variants} variants.`);
    const topCut = data.movers.down.find((m) => !m.variant.isReferenceBrand);
    if (topCut) {
      const product = topCut.variant.familyTitle.replace(topCut.variant.brandName ?? "", "").split(/[,(]/)[0]!.trim();
      parts.push(`${topCut.variant.brandName ?? "A competitor"} cut ${product} ${topCut.variant.label} by ${formatPct(Math.abs(topCut.ratio))}.`);
    }
    const oos = data.attention.filter((a) => a.reason === "Currently unavailable").length;
    if (oos) parts.push(`${oos} listing${oos === 1 ? " is" : "s are"} unavailable.`);
    return parts.join(" ");
  }, [k, data.movers.down, data.attention]);

  if (!k.variants) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-10 md:px-8">
        <EmptyState
          icon={<Package />}
          title="Your market, in focus — once you add a product"
          description="Paste an Amazon link to start. Aisle discovers every variant, normalizes unit prices, and checks hourly in the background."
          action={
            <Button variant="primary" size="lg" onClick={() => importer.open()}>
              Add your first product
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 px-4 py-6 md:px-8 md:py-8">
      {/* Hero */}
      <motion.section {...appear(0)} className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-[760px]">
          <div className="eyebrow flex items-center gap-2">
            {greeting(app.workspace.timeZone)}, {firstName}
            {data.isSimulated && <SimulatedBadge />}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Your market, in focus.</h1>
          <p className="mt-2 text-md leading-relaxed text-ink-2">{summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-ink-3">
          <Clock className="size-3.5" />
          <span title={`Rendered ${new Date(renderedAt).toLocaleString()}`}>Last successful check {relativeTime(data.lastRefreshAt)}</span>
        </div>
      </motion.section>

      {/* KPI strip — one calm surface, not a sea of cards */}
      <motion.section {...appear(1)} className="card grid grid-cols-2 overflow-hidden sm:grid-cols-3 lg:grid-cols-6" aria-label="Key metrics">
        <Kpi href="/products" label="Products tracked" value={k.products} icon={Package} />
        <Kpi href={k.paused ? "/products?status=paused" : "/products"} label="Variants monitored" value={k.monitored} sub={k.variants !== k.monitored ? `of ${k.variants}${k.paused ? ` · ${k.paused} paused` : ""}` : undefined} icon={Boxes} />
        <Kpi href="/brands" label="Competitor brands" value={k.competitorBrands} icon={Tag} />
        <Kpi href="/history" label="Price changes · 24h" value={k.changes24h} icon={RefreshCw} />
        <Kpi href="/alerts" label="Alerts · 24h" value={k.alerts24h} sub={`${k.activeRules} active rules`} icon={Bell} />
        <Kpi href="/settings#monitoring" label="Fresh data" value={k.coverage === null ? null : Math.round(k.coverage * 100)} suffix="%" icon={Clock} bar={k.coverage} />
      </motion.section>

      {/* Trend + what changed */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <motion.section {...appear(2)} className="card p-5">
          <SectionHeader title="Portfolio price index" description="Median price vs. 30 days ago (100 = then). Same listings, one axis." action={<ButtonLink href="/history" variant="ghost" size="sm">History <ArrowRight className="size-3.5" /></ButtonLink>} />
          <div className="mt-4">
            <IndexTrendChart data={data.trend} height={300} referenceLabel={refBrand ?? "Reference"} />
          </div>
        </motion.section>

        <motion.section {...appear(3)} className="card flex flex-col p-5">
          <SectionHeader title="What changed" description="Verified from stored observations" action={<ButtonLink href="/insights" variant="ghost" size="sm">All insights <ArrowRight className="size-3.5" /></ButtonLink>} />
          <ul className="mt-3 flex-1 space-y-1">
            {insights.length === 0 && <li className="py-8 text-center text-sm text-ink-3">Nothing notable yet. Insights appear as observations accumulate.</li>}
            {insights.map((ins, i) => (
              <motion.li key={ins.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring.gentle, delay: 0.2 + staggerDelay(i) }}>
                <Link href={ins.href} className="group -mx-2 flex gap-3 rounded-[12px] px-2 py-2.5 outline-none transition-colors hover:bg-[var(--hairline)] focus-visible:bg-[var(--hairline)]">
                  <InsightIcon kind={ins.kind} tone={ins.tone} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-snug text-ink">{ins.headline}</div>
                    <div className="mt-0.5 line-clamp-1 text-xs text-ink-3">{ins.explanation}</div>
                  </div>
                  <ArrowRight className="mt-1 size-3.5 shrink-0 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </motion.li>
            ))}
          </ul>
        </motion.section>
      </div>

      {/* Movers & attention */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        <motion.section {...appear(4)} className="card p-5">
          <SectionHeader title="Largest decreases" description="Last 24 hours" />
          <MoverList movers={data.movers.down} empty="No decreases in the last 24 hours." />
        </motion.section>
        <motion.section {...appear(5)} className="card p-5">
          <SectionHeader title="Largest increases" description="Last 24 hours" />
          <MoverList movers={data.movers.up} empty="No increases in the last 24 hours." />
        </motion.section>
        <motion.section {...appear(6)} className="card p-5 md:col-span-2 xl:col-span-1">
          <SectionHeader title="Needs attention" description="Unavailable, failing or incomplete" />
          <ul className="mt-3 space-y-0.5">
            {data.attention.length === 0 && <li className="py-6 text-center text-sm text-ink-3">Everything looks healthy.</li>}
            {data.attention.slice(0, 6).map((a) => (
              <li key={a.variant.variantId}>
                <Link href={`/products/${a.variant.familyId}?variant=${a.variant.variantId}`} className="-mx-2 flex items-center gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-[var(--hairline)]">
                  <ProductImage src={a.variant.imageUrl} alt="" size={32} rounded={8} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{a.variant.brandName} {a.variant.label}</div>
                    <div className="truncate text-xs text-ink-3">{a.reason}</div>
                  </div>
                  {a.reason === "Currently unavailable" ? <CircleSlash className="size-4 text-bad" /> : <AlertTriangle className="size-4 text-warn" />}
                </Link>
              </li>
            ))}
          </ul>
        </motion.section>
      </div>

      {/* Brands + activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <motion.section {...appear(7)} className="card p-5">
          <SectionHeader title="Brands you monitor" description="Tracked listings only — not market share" action={<ButtonLink href="/brands" variant="ghost" size="sm">Brands <ArrowRight className="size-3.5" /></ButtonLink>} />
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-3">
                <th className="pb-2 font-semibold">Brand</th>
                <th className="pb-2 text-right font-semibold">Variants</th>
                <th className="pb-2 text-right font-semibold">Avg 7d</th>
                <th className="pb-2 text-right font-semibold">In stock</th>
              </tr>
            </thead>
            <tbody>
              {data.brands.map((b) => (
                <tr key={b.name} className="hairline-t">
                  <td className="py-2.5">
                    <Link href={`/brands?brand=${encodeURIComponent(b.name)}`} className="flex items-center gap-2 font-medium hover:text-accent">
                      {b.name}
                      {b.isReference && <Badge tone="accent" size="xs">Reference</Badge>}
                    </Link>
                  </td>
                  <td className="num py-2.5 text-right text-ink-2">{b.variants}</td>
                  <td className="py-2.5 text-right"><Delta ratio={b.avgChange7d} /></td>
                  <td className="num py-2.5 text-right text-ink-2">{Math.round(b.inStockShare * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.section>

        <motion.section {...appear(8)} className="card p-5">
          <SectionHeader title="Activity" description="Price movements and changes across your workspace" action={<ButtonLink href="/activity" variant="ghost" size="sm">All activity <ArrowRight className="size-3.5" /></ButtonLink>} />
          <ol className="relative mt-3 space-y-0.5">
            {data.activity.slice(0, 9).map((a) => (
              <li key={a.id}>
                <Link href={a.entityType === "family" && a.entityId ? `/products/${a.entityId}` : "/activity"} className="-mx-2 flex items-start gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-[var(--hairline)]">
                  <ActivityIcon kind={a.kind} />
                  <span className="min-w-0 flex-1 text-sm leading-snug text-ink">{a.message}</span>
                  <span className="shrink-0 pt-0.5 text-2xs text-ink-3">{relativeTime(a.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </motion.section>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, href, suffix, bar }: { label: string; value: number | null; sub?: string; icon: typeof Package; href: string; suffix?: string; bar?: number | null }) {
  return (
    <Link href={href} className="group relative flex flex-col gap-1 p-4 outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 [&:not(:last-child)]:shadow-[inset_-0.5px_0_0_var(--line)] max-lg:[&:nth-child(n+3)]:shadow-[inset_0_0.5px_0_var(--line),inset_-0.5px_0_0_var(--line)]">
      <div className="flex items-center gap-1.5 text-xs text-ink-3">
        <Icon className="size-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <AnimatedNumber value={value} format={(n) => `${Math.round(n)}${suffix ?? ""}`} animateOnMount className="text-2xl font-semibold tracking-tight" />
        {sub && <span className="text-xs text-ink-3">{sub}</span>}
      </div>
      {bar != null && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--line)]">
          <motion.div className={cn("h-full rounded-full", bar > 0.8 ? "bg-good" : bar > 0.5 ? "bg-warn" : "bg-bad")} initial={{ width: 0 }} animate={{ width: `${bar * 100}%` }} transition={{ ...spring.gentle, delay: 0.3 }} />
        </div>
      )}
    </Link>
  );
}

function MoverList({ movers, empty }: { movers: Mover[]; empty: string }) {
  if (!movers.length) return <p className="py-8 text-center text-sm text-ink-3">{empty}</p>;
  return (
    <ul className="mt-3 space-y-0.5">
      {movers.map((m) => (
        <li key={m.variant.variantId}>
          <Link href={`/products/${m.variant.familyId}?variant=${m.variant.variantId}`} className="-mx-2 flex items-center gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-[var(--hairline)]">
            <ProductImage src={m.variant.imageUrl} alt="" size={32} rounded={8} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {m.variant.brandName} <span className="text-ink-2">{m.variant.label}</span>
              </div>
              <div className="num truncate text-xs text-ink-3">
                {formatMoney(m.from, m.variant.currency ?? "INR")} → <span className="text-ink-2">{formatMoney(m.to, m.variant.currency ?? "INR")}</span>
              </div>
            </div>
            <Delta ratio={m.ratio} size="sm" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function InsightIcon({ kind, tone }: { kind: string; tone: string }) {
  const Icon = kind === "competitor_cut" ? TrendingDown : kind === "competitor_raise" ? TrendingUp : kind === "competitor_unavailable" ? CircleSlash : kind === "reference_lost_lead" ? BarChart3 : kind === "unusual_move" ? Zap : kind === "promo_cycle" ? Repeat : kind === "price_trend" ? TrendingUp : Sparkles;
  return (
    <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[8px]", tone === "warning" ? "bg-warn-soft text-warn" : tone === "negative" ? "bg-bad-soft text-bad" : tone === "positive" ? "bg-good-soft text-good" : "bg-accent-soft text-accent")}>
      <Icon className="size-3.5" strokeWidth={2.2} />
    </span>
  );
}

function ActivityIcon({ kind }: { kind: string }) {
  const map: Record<string, { icon: typeof Package; cls: string }> = {
    price_down: { icon: ArrowDownRight, cls: "text-down bg-down-soft" },
    price_up: { icon: ArrowUpRight, cls: "text-up bg-up-soft" },
    stock_out: { icon: CircleSlash, cls: "text-bad bg-bad-soft" },
    out_of_stock: { icon: CircleSlash, cls: "text-bad bg-bad-soft" },
    stock_in: { icon: Package, cls: "text-good bg-good-soft" },
    back_in_stock: { icon: Package, cls: "text-good bg-good-soft" },
    import: { icon: Package, cls: "text-accent bg-accent-soft" },
  };
  const m = map[kind] ?? { icon: Sparkles, cls: "text-ink-3 bg-[var(--hairline)]" };
  return (
    <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", m.cls)}>
      <m.icon className="size-3.5" strokeWidth={2.2} />
    </span>
  );
}
