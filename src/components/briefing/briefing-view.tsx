"use client";

import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Gauge, Newspaper, RefreshCw, ShieldAlert, TrendingDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { BriefingContent, PositionPoint } from "@/lib/briefing-types";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/freshness";
import { formatMoney, formatPct } from "@/lib/money";
import { NORMALIZATION_BASES, isNormalizationBasis } from "@/lib/quantity";
import { shortDay, weekLabel } from "@/lib/week";
import { IndexTrendChart } from "../charts/index-trend-chart";
import { spring, staggerDelay } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { EmptyState, SectionHeader } from "../ui/empty-state";
import { Delta } from "../ui/price";
import { Select } from "../ui/select";
import { SimulatedBadge } from "../ui/status";

export interface BriefingData {
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  generatedAt: string;
  version: number;
  containsSimulated: boolean;
  content: BriefingContent;
}

const appear = (i: number) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { ...spring.gentle, delay: staggerDelay(i, 0.05) } });
const dash = <span className="text-ink-4">—</span>;

export function BriefingView({ briefing, archive, canEdit, lastWeekStart }: { briefing: BriefingData | null; archive: { weekStart: string; weekEnd: string; containsSimulated: boolean }[]; canEdit: boolean; lastWeekStart: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"generate" | "regenerate" | null>(null);

  async function generate(force: boolean, weekStart?: string) {
    setBusy(force ? "regenerate" : "generate");
    try {
      const r = await api<{ weekStart: string; created: boolean; version: number }>("/api/briefings", { method: "POST", body: { weekStart, force } });
      toast.success(force ? `Briefing rebuilt (version ${r.version})` : r.created ? "Briefing ready" : "Briefing already up to date");
      router.push(`/briefing/${r.weekStart}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't build the briefing.");
    } finally {
      setBusy(null);
    }
  }

  const hasLastWeek = archive.some((a) => a.weekStart === lastWeekStart);

  if (!briefing) {
    return (
      <EmptyState
        icon={<Newspaper />}
        title="No briefing yet"
        description="Every Monday Aisle writes up the previous week: your position, the biggest moves, undercuts and drops — with how much of it is backed by data."
        action={canEdit ? <Button variant="primary" size="lg" loading={busy === "generate"} onClick={() => generate(false)}>Build last week’s briefing</Button> : undefined}
      />
    );
  }

  const c = briefing.content;
  const ref = c.referenceBrand;
  const trend = c.trend.map((d) => ({ t: Date.parse(`${d.day}T12:00:00Z`), reference: d.reference, competitors: d.competitors }));

  return (
    <div className="space-y-6">
      {/* Header strip */}
      <motion.div {...appear(0)} className="flex flex-wrap items-center gap-2">
        <CalendarDays className="size-4 text-ink-3" />
        <span className="text-sm font-medium">{weekLabel(briefing)}</span>
        <span className="text-xs text-ink-3">Monday–Sunday · {briefing.timeZone} · built {relativeTime(briefing.generatedAt)}{briefing.version > 1 ? ` · v${briefing.version}` : ""}</span>
        {briefing.containsSimulated && <SimulatedBadge />}
        <div className="ml-auto flex items-center gap-2">
          {archive.length > 1 && (
            <Select ariaLabel="Choose a week" size="sm" value={briefing.weekStart} onValueChange={(v) => router.push(`/briefing/${v}`)} options={archive.map((a) => ({ value: a.weekStart, label: weekLabel(a), hint: a.containsSimulated ? "Sim" : undefined }))} />
          )}
          {canEdit && !hasLastWeek && (
            <Button size="sm" variant="primary" loading={busy === "generate"} onClick={() => generate(false)}>
              Build last week
            </Button>
          )}
          {canEdit && (
            <Button size="sm" variant="ghost" loading={busy === "regenerate"} onClick={() => generate(true, briefing.weekStart)} title="Rebuild from the observations stored now">
              <RefreshCw className="size-3.5" /> Rebuild
            </Button>
          )}
        </div>
      </motion.div>

      {/* A — Summary */}
      <motion.section {...appear(1)} className="card p-5 md:p-6" aria-labelledby="b-summary">
        <div className="eyebrow">A · Summary</div>
        <h2 id="b-summary" className="sr-only">Summary</h2>
        <div className="mt-2 space-y-1.5 text-lg leading-relaxed text-ink">
          {c.summary.sentences.map((s, i) => <p key={i}>{s}</p>)}
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] bg-[var(--hairline)] sm:grid-cols-4">
          {[
            ["Observations", c.summary.observations.toLocaleString("en-IN")],
            ["Listings observed", `${c.summary.listingsObserved} of ${c.summary.trackedListings}`],
            ["Price changes", String(c.summary.priceChanges)],
            ["Alerts fired", `${c.summary.alertsFired}${c.summary.protectionAlerts ? ` · ${c.summary.protectionAlerts} protection` : ""}`],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface px-4 py-3">
              <dt className="text-2xs text-ink-3">{k}</dt>
              <dd className="num mt-0.5 text-md font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </motion.section>

      {/* B — Position */}
      <motion.section {...appear(2)} className="card p-5">
        <SectionHeader eyebrow="B · Position" title={ref ? `${ref.name} vs the market` : "Your position"} description="Best unit price vs the competitor median, at the start and end of the week" />
        {!ref ? (
          <p className="mt-4 text-sm text-ink-2">Choose your brand on the <Link href="/brands" className="font-medium text-accent">Brands page</Link> to see where it stands each week.</p>
        ) : c.position.length === 0 ? (
          <p className="mt-4 text-sm text-ink-2">No comparisons yet — nothing tracked shares a category and unit with {ref.name}.</p>
        ) : (
          <>
          {/* Phones: one stacked row per comparison. */}
          <ul className="mt-3 divide-y divide-[var(--hairline)] sm:hidden">
            {c.position.map((p) => {
              const delta = p.start?.premium != null && p.end?.premium != null ? p.end.premium - p.start.premium : null;
              return (
                <li key={p.groupId} className="py-2.5">
                  <Link href={`/comparisons/${p.groupId}`} className="text-sm font-medium">{p.name.split(" · ").slice(1).join(" · ") || p.name}</Link>
                  <div className="num mt-1 flex items-center gap-2 text-sm">
                    <span className="text-ink-3">{premium(p.start)}</span>
                    <span className="text-ink-4">→</span>
                    <span className="font-semibold">{premium(p.end)}</span>
                    <span className="ml-auto text-xs"><PointChange delta={delta} /></span>
                  </div>
                  <div className="text-2xs text-ink-3">Lowest at end: {p.end?.referenceIsCheapest ? "you" : (p.end?.cheapestBrand ?? "—")}</div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-wide text-ink-3">
                  <th className="pb-2 font-semibold">Comparison</th>
                  <th className="pb-2 text-right font-semibold">Start</th>
                  <th className="pb-2 text-right font-semibold">End</th>
                  <th className="pb-2 text-right font-semibold">Change</th>
                  <th className="pb-2 pl-4 font-semibold">Lowest price at end</th>
                </tr>
              </thead>
              <tbody>
                {c.position.map((p) => {
                  const delta = p.start?.premium != null && p.end?.premium != null ? p.end.premium - p.start.premium : null;
                  return (
                    <tr key={p.groupId} className="hairline-t">
                      <td className="py-2.5 pr-3">
                        <Link href={`/comparisons/${p.groupId}`} className="font-medium hover:text-accent">{p.name.split(" · ").slice(1).join(" · ") || p.name}</Link>
                        <div className="num text-2xs text-ink-3">{p.end ? `${p.end.comparable} comparable · rank ${p.end.rank ?? "—"}` : "No prices at week's end"}</div>
                      </td>
                      <td className="num py-2.5 text-right">{premium(p.start)}</td>
                      <td className="num py-2.5 text-right font-semibold">{premium(p.end)}</td>
                      <td className="num py-2.5 text-right"><PointChange delta={delta} /></td>
                      <td className="py-2.5 pl-4 text-xs text-ink-2">{p.end?.referenceIsCheapest ? <Badge tone="accent" size="xs">You</Badge> : (p.end?.cheapestBrand ?? dash)}{p.end?.referenceUnit != null && isNormalizationBasis(p.basis) && <span className="num ml-2 text-ink-3">yours {formatMoney(p.end.referenceUnit, p.currency ?? "INR", undefined, { trimZeros: false })}{NORMALIZATION_BASES[p.basis].label}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-2xs text-ink-3">Premium = (your best unit price − competitor median) ÷ competitor median. Change is in percentage points; ▲ means pricier relative to the market.</p>
          </>
        )}
      </motion.section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* C — Movers */}
        <motion.section {...appear(3)} className="card p-5">
          <SectionHeader eyebrow="C · Movers" title="Biggest moves this week" description="Price at the start vs the end of the week" />
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MoveList title="Decreases" icon={<ArrowDownRight className="size-3.5 text-down" />} moves={c.movers.down} />
            <MoveList title="Increases" icon={<ArrowUpRight className="size-3.5 text-up" />} moves={c.movers.up} />
          </div>
        </motion.section>

        {/* D — Undercuts & leadership */}
        <motion.section {...appear(4)} className="card p-5">
          <SectionHeader eyebrow="D · Undercuts & leadership" title="Who's pricing below you" description="Alerts during the week and the state at its end" />
          {!ref ? (
            <p className="mt-3 text-sm text-ink-3">Needs your brand to be set.</p>
          ) : (
            <>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {c.competitive.undercutAtEnd.map((u) => (
                  <li key={u.groupId}>
                    <Link href={`/comparisons/${u.groupId}`} className={cn("flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium shadow-[var(--ring-inset)]", u.undercutters ? "bg-warn-soft text-ink" : "bg-surface-2 text-ink-2")}>
                      {u.undercutters ? <ShieldAlert className="size-3.5 text-warn" /> : null}
                      {u.name.split(" · ")[1] ?? u.name}: {u.undercutters ? `${u.undercutters} below you` : "no undercut"}
                    </Link>
                  </li>
                ))}
              </ul>
              <ul className="mt-3 space-y-0.5">
                {c.competitive.events.length === 0 && <li className="py-3 text-sm text-ink-3">No undercut or leadership alerts this week.</li>}
                {c.competitive.events.slice(0, 8).map((e) => (
                  <li key={e.id}>
                    <Link href={`/alerts?event=${e.id}`} className="-mx-2 flex items-start gap-3 rounded-[9px] px-2 py-2 hover:bg-[var(--hairline)]">
                      <span className="num w-[76px] shrink-0 pt-0.5 text-2xs text-ink-3">{shortDay(e.firedAt, briefing.timeZone)}</span>
                      <span className="min-w-0 flex-1 text-sm">{e.headline}</span>
                      {e.isSimulated && <SimulatedBadge compact />}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </motion.section>
      </div>

      {/* E — Drops ≥ 5% */}
      <motion.section {...appear(5)} className="card p-5">
        <SectionHeader eyebrow="E · Drops of 5% or more" title={c.drops.length ? `${c.drops.length} sharp drop${c.drops.length === 1 ? "" : "s"}` : "No sharp drops"} description="Between two consecutive checks of the same listing" />
        {c.drops.length > 0 && (
          <ul className="mt-3 divide-y divide-[var(--hairline)]">
            {c.drops.slice(0, 12).map((d, i) => (
              <li key={`${d.listing.variantId}-${d.at}-${i}`}>
                <Link href={`/products/${d.listing.familyId}?variant=${d.listing.variantId}`} className="-mx-2 flex items-center gap-3 rounded-[9px] px-2 py-2 hover:bg-[var(--hairline)]">
                  <TrendingDown className="size-4 shrink-0 text-down" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-medium">{d.listing.brandName ?? "Unbranded"}</span> {d.listing.name}
                    {d.listing.isReference && <Badge tone="accent" size="xs" className="ml-1.5">Yours</Badge>}
                  </span>
                  <span className="num hidden text-xs text-ink-3 sm:inline">{formatMoney(d.from, d.currency)} → {formatMoney(d.to, d.currency)}</span>
                  <Delta ratio={d.ratio} />
                  <span className="num hidden w-[84px] text-right text-2xs text-ink-3 md:inline">{shortDay(d.at, briefing.timeZone)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </motion.section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* F — Trend */}
        <motion.section {...appear(6)} className="card p-5">
          <SectionHeader eyebrow="F · Trend" title="Daily price index" description="Median of each listing's price ÷ its price at the start of the week" />
          <div className="mt-4">
            <IndexTrendChart data={trend} height={240} referenceLabel={ref?.name ?? "Your brand"} since="at the start of the week" emptyText="Not enough observations this week to draw an index." />
          </div>
        </motion.section>

        {/* G — Data confidence */}
        <motion.section {...appear(7)} className="card p-5">
          <SectionHeader eyebrow="G · Data confidence" title={c.confidence.coverage === null ? "No tracked listings" : `${formatPct(c.confidence.coverage)} of listings observed`} description="How much of this briefing rests on data" />
          <dl className="mt-4 space-y-2 text-sm">
            <Stat label="Observations" value={c.confidence.observations.toLocaleString("en-IN")} sub={c.confidence.simulatedObservations ? `${c.confidence.simulatedObservations.toLocaleString("en-IN")} simulated` : "all verified"} />
            <Stat label="Listings without a recent price at week's end" value={String(c.confidence.staleAtEnd)} />
            <Stat label="Listings with refresh failures" value={String(c.confidence.listingsWithFailures)} />
            <Stat label="Pack sizes" value={`${c.confidence.quantities.manual} confirmed · ${c.confidence.quantities.parsed + c.confidence.quantities.provider} detected`} sub={c.confidence.quantities.missing ? `${c.confidence.quantities.missing} unknown` : undefined} />
          </dl>
          <ul className="mt-4 space-y-1.5 text-xs text-ink-2">
            {c.confidence.notes.map((n, i) => (
              <li key={i} className="flex gap-2"><Gauge className="mt-0.5 size-3.5 shrink-0 text-ink-3" />{n}</li>
            ))}
          </ul>
        </motion.section>
      </div>
    </div>
  );
}

/** A change in premium, in percentage points. */
function PointChange({ delta }: { delta: number | null }) {
  if (delta === null) return dash;
  if (Math.abs(delta) < 0.0005) return <span className="text-ink-3">no change</span>;
  const v = Math.round(Math.abs(delta) * 1000) / 10;
  return (
    <span className={delta > 0 ? "text-up" : "text-down"}>
      {delta > 0 ? "▲" : "▼"} {Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)} pts
    </span>
  );
}

function premium(p: PositionPoint | null) {
  if (!p || p.premium === null) return dash;
  return formatPct(p.premium, { signed: true });
}

function MoveList({ title, icon, moves }: { title: string; icon: React.ReactNode; moves: BriefingContent["movers"]["down"] }) {
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">{icon}{title}</h3>
      <ul className="mt-1.5 space-y-0.5">
        {moves.length === 0 && <li className="py-2 text-xs text-ink-3">None observed.</li>}
        {moves.map((m) => (
          <li key={m.listing.variantId}>
            <Link href={`/products/${m.listing.familyId}?variant=${m.listing.variantId}`} className="-mx-2 flex items-center gap-2 rounded-[9px] px-2 py-1.5 hover:bg-[var(--hairline)]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{m.listing.brandName ?? "Unbranded"}{m.listing.isReference ? " (yours)" : ""}</span>
                <span className="num block truncate text-2xs text-ink-3">{m.listing.name} · {formatMoney(m.from, m.currency)} → {formatMoney(m.to, m.currency)}</span>
              </span>
              <Delta ratio={m.ratio} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 hairline-b pb-2">
      <dt className="text-ink-2">{label}</dt>
      <dd className="num text-right font-medium">
        {value}
        {sub && <span className="ml-1.5 text-2xs font-normal text-ink-3">{sub}</span>}
      </dd>
    </div>
  );
}
