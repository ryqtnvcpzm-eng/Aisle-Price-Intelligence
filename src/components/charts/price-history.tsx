"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CalendarRange, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Brush, CartesianGrid, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatMoney, formatPct } from "@/lib/money";
import { DASHES, brandColorMap, SERIES_VARS, OTHER_VAR } from "@/lib/series-colors";
import type { HistorySeries } from "@/server/analytics/history";
import { spring } from "../motion/tokens";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/empty-state";
import { Popover } from "../ui/popover";
import { Segmented } from "../ui/segmented";
import { ChartTooltip } from "./chart-tooltip";

export type RangeKey = "24h" | "7d" | "30d" | "90d" | "6m" | "1y" | "all" | "custom";
const RANGE_MS: Record<Exclude<RangeKey, "custom" | "all">, number> = { "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5, "90d": 90 * 864e5, "6m": 182 * 864e5, "1y": 365 * 864e5 };

export interface SeriesOption {
  variantId: string;
  name: string;
  brandName: string | null;
  isReference: boolean;
}

interface HistoryResponse {
  series: HistorySeries[];
  from: string;
  to: string;
  renderedAt: string;
}

/** Value of a gap-aware step series at time t (null inside unknown stretches). */
function stepValue(points: HistorySeries["points"], t: number): number | null {
  let lo = 0;
  let hi = points.length - 1;
  let ans: HistorySeries["points"][number] | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) {
      ans = points[mid]!;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans && ans.known ? ans.price : null;
}

const EVENT_STYLE: Record<string, { fill: string; label: string }> = {
  out_of_stock: { fill: "var(--bad)", label: "Became unavailable" },
  back_in_stock: { fill: "var(--good)", label: "Back in stock" },
  decrease: { fill: "var(--down)", label: "Price decrease" },
  increase: { fill: "var(--up)", label: "Price increase" },
  baseline: { fill: "var(--up)", label: "Returned to typical price" },
  discount_started: { fill: "var(--accent)", label: "Deal observed" },
  seller_change: { fill: "var(--ink-3)", label: "Featured seller changed" },
};

/**
 * Interactive price history — the signature chart.
 *  - Step geometry: a price holds until the next observation; long gaps break the line (never interpolated).
 *  - Crosshair tooltip lists every visible series at the hovered instant.
 *  - Range changes keep the previous frame (dimmed) until new data lands — no flash, no zero-baseline animation.
 *  - Series toggles keep each entity's color; a table view is always one click away.
 */
export function PriceHistory({ options, initialSelected, colorBy = "brand", defaultRange = "30d", height = 340, compact, unitScale, unitLabel }: { options: SeriesOption[]; initialSelected?: string[]; colorBy?: "brand" | "series"; defaultRange?: RangeKey; height?: number; compact?: boolean; /** Display-only normalization: price × num ÷ den per variant (e.g. per 100 g). */ unitScale?: Record<string, { num: number; den: number } | null>; unitLabel?: string }) {
  const reduce = useReducedMotion();
  const [range, setRange] = useState<RangeKey>(defaultRange);
  const [custom, setCustom] = useState<{ from: string; to: string }>(() => ({ from: new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }));
  const [selected, setSelected] = useState<string[]>(initialSelected ?? options.slice(0, 6).map((o) => o.variantId));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showTable, setShowTable] = useState(false);
  const [showEvents, setShowEvents] = useState(true);

  const win = useMemo(() => {
    const now = Date.now();
    if (range === "custom") return { from: new Date(custom.from).getTime(), to: Math.min(now, new Date(custom.to).getTime() + 864e5 - 1) };
    if (range === "all") return { from: now - 3 * 365 * 864e5, to: now };
    return { from: now - RANGE_MS[range], to: now };
    // Bucket "now" to the minute so the query key is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, custom, Math.floor(Date.now() / 60000)]);

  const { data, isFetching, isPlaceholderData, error } = useQuery({
    queryKey: ["history", selected.slice().sort().join(","), win.from, win.to],
    queryFn: () => api<HistoryResponse>(`/api/history?variants=${selected.join(",")}&from=${new Date(win.from).toISOString()}&to=${new Date(win.to).toISOString()}`),
    enabled: selected.length > 0,
    placeholderData: keepPreviousData,
  });

  // Stable entity colors: brand-based (cross-brand views) or position-based (one family's variants).
  // One brand on screen → distinguish variants by hue instead of dashes.
  const singleBrand = new Set(options.filter((o) => selected.includes(o.variantId)).map((o) => o.brandName)).size <= 1;
  const effColorBy = singleBrand ? "series" : colorBy;
  const colors = useMemo(() => {
    const map = new Map<string, { color: string; dash: string }>();
    if (effColorBy === "brand") {
      const brandMap = brandColorMap(options.map((o) => ({ name: o.brandName, isReference: o.isReference })));
      const perBrand = new Map<string, number>();
      for (const o of options) {
        const b = o.brandName ?? "Unbranded";
        const n = perBrand.get(b) ?? 0;
        perBrand.set(b, n + 1);
        map.set(o.variantId, { color: brandMap.get(b) ?? OTHER_VAR, dash: DASHES[n % DASHES.length]! });
      }
    } else {
      options.filter((o) => selected.includes(o.variantId)).forEach((o, i) => map.set(o.variantId, { color: SERIES_VARS[i % SERIES_VARS.length]!, dash: i >= SERIES_VARS.length ? DASHES[1]! : "0" }));
      options.filter((o) => !selected.includes(o.variantId)).forEach((o) => map.set(o.variantId, { color: OTHER_VAR, dash: "0" }));
    }
    return map;
  }, [options, effColorBy, selected]);

  const scale = (id: string, v: number | null) => {
    if (v === null || !unitScale) return v;
    const f = unitScale[id];
    return f ? Math.round((v * f.num) / f.den) : null;
  };
  const series = (data?.series ?? [])
    .filter((s) => selected.includes(s.variantId) && (!unitScale || unitScale[s.variantId]))
    .map((s) =>
      unitScale
        ? {
            ...s,
            points: s.points.map((p) => ({ ...p, price: scale(s.variantId, p.price) })),
            raw: s.raw.map((p) => ({ ...p, price: scale(s.variantId, p.price) })),
            events: s.events.map((e) => ({ ...e, from: scale(s.variantId, e.from), to: scale(s.variantId, e.to) })),
            stats: { ...s.stats, min: scale(s.variantId, s.stats.min), max: scale(s.variantId, s.stats.max), median: scale(s.variantId, s.stats.median), timeWeightedAvg: s.stats.timeWeightedAvg === null ? null : scale(s.variantId, Math.round(s.stats.timeWeightedAvg)) },
          }
        : s,
    );
  const currencies = [...new Set(series.map((s) => s.currency).filter(Boolean))] as string[];
  const currency = currencies[0] ?? "INR";
  const plotted = series.filter((s) => s.currency === currency);
  const excluded = series.filter((s) => s.currency !== currency);
  const visible = plotted.filter((s) => !hidden.has(s.variantId));

  // Merge onto the union of change times; each series evaluated as a step function.
  const rows = useMemo(() => {
    const ts = new Set<number>();
    for (const s of visible) for (const p of s.points) ts.add(p.t);
    const sorted = [...ts].sort((a, b) => a - b);
    return sorted.map((t) => {
      const row: Record<string, number | null> = { t };
      for (const s of visible) row[s.variantId] = stepValue(s.points, t);
      return row;
    });
  }, [visible]);

  const allVals = rows.flatMap((r) => visible.map((s) => r[s.variantId])).filter((v): v is number => typeof v === "number");
  const minV = allVals.length ? Math.min(...allVals) : 0;
  const maxV = allVals.length ? Math.max(...allVals) : 1;
  const pad = Math.max(1, (maxV - minV) * 0.12);
  const spanMs = win.to - win.from;
  const fmtTick = (t: number) => new Date(t).toLocaleString(undefined, spanMs <= 2 * 864e5 ? { hour: "numeric", minute: "2-digit" } : spanMs <= 120 * 864e5 ? { month: "short", day: "numeric" } : { month: "short", year: "2-digit" });
  const fmtFull = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const money = (v: number) => (unitScale ? `${formatMoney(v, currency, undefined, { trimZeros: false })}${unitLabel ?? ""}` : formatMoney(v, currency));
  const eventsShown = showEvents && visible.length <= 4;

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<RangeKey>
          ariaLabel="Time range"
          size="sm"
          value={range}
          onChange={setRange}
          className="max-w-full overflow-x-auto no-scrollbar"
          options={(["24h", "7d", "30d", "90d", "6m", "1y", "all"] as RangeKey[]).map((r) => ({ value: r, label: r === "all" ? "All" : r.toUpperCase() }))}
        />
        <Popover
          align="start"
          className="w-[260px] p-3"
          trigger={
            <Button variant={range === "custom" ? "tinted" : "ghost"} size="sm">
              <CalendarRange className="size-3.5" /> {range === "custom" ? `${custom.from} → ${custom.to}` : "Custom"}
            </Button>
          }
        >
          <div className="space-y-2.5 p-1">
            <label className="block text-xs font-medium text-ink-2">
              From
              <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="mt-1 h-8 w-full rounded-[8px] bg-surface px-2 text-sm shadow-[inset_0_0_0_0.5px_var(--line-strong)]" />
            </label>
            <label className="block text-xs font-medium text-ink-2">
              To
              <input type="date" value={custom.to} min={custom.from} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="mt-1 h-8 w-full rounded-[8px] bg-surface px-2 text-sm shadow-[inset_0_0_0_0.5px_var(--line-strong)]" />
            </label>
            <Button variant="primary" size="sm" className="w-full" onClick={() => setRange("custom")}>
              Apply range
            </Button>
          </div>
        </Popover>
        <div className="ml-auto flex items-center gap-1">
          <Button variant={showEvents ? "tinted" : "ghost"} size="sm" onClick={() => setShowEvents((v) => !v)} aria-pressed={showEvents} title="Event markers show for up to four visible series">
            Events
          </Button>
          <Button variant={showTable ? "tinted" : "ghost"} size="sm" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
            <Table2 className="size-3.5" /> Table
          </Button>
        </div>
      </div>

      {/* Legend = series toggles (identity by name + line key, never color alone) */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Series">
        {options
          .filter((o) => selected.includes(o.variantId))
          .map((o) => {
            const c = colors.get(o.variantId)!;
            const off = hidden.has(o.variantId);
            return (
              <motion.button
                key={o.variantId}
                layout
                whileTap={{ scale: 0.96 }}
                transition={spring.press}
                onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(o.variantId)) n.delete(o.variantId); else n.add(o.variantId); return n; })}
                aria-pressed={!off}
                className={cn("flex h-7 items-center gap-2 rounded-full px-2.5 text-xs font-medium transition-all", off ? "text-ink-4 shadow-[inset_0_0_0_0.5px_var(--line)]" : "bg-surface text-ink shadow-[var(--shadow-xs),inset_0_0_0_0.5px_var(--line-strong)]")}
              >
                <svg width="16" height="4" aria-hidden>
                  <line x1="1" y1="2" x2="15" y2="2" stroke={off ? "var(--ink-4)" : c.color} strokeWidth="2.5" strokeDasharray={c.dash !== "0" ? c.dash : undefined} strokeLinecap="round" />
                </svg>
                {o.name}
                {o.isReference && effColorBy === "brand" && <span className="text-2xs text-accent">ref</span>}
              </motion.button>
            );
          })}
        {options.length > selected.length && (
          <Popover
            align="start"
            className="max-h-[320px] w-[300px] overflow-y-auto p-1.5"
            trigger={
              <button className="flex h-7 items-center rounded-full px-2.5 text-xs font-medium text-accent hover:bg-accent-softer">+ Add series</button>
            }
          >
            {options
              .filter((o) => !selected.includes(o.variantId))
              .map((o) => (
                <button key={o.variantId} onClick={() => setSelected((s) => (s.length >= 24 ? s : [...s, o.variantId]))} className="flex w-full items-center rounded-[8px] px-2.5 py-2 text-left text-sm hover:bg-[var(--hairline)]">
                  {o.name}
                </button>
              ))}
          </Popover>
        )}
      </div>

      <div className="relative" style={{ height }}>
        {!data && isFetching ? (
          <Skeleton className="h-full w-full rounded-[14px]" />
        ) : error ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-3">Couldn't load history. {String((error as Error).message)}</div>
        ) : !visible.length || !rows.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-ink-3">
            <span>No observations in this window.</span>
            <span className="text-xs">Aisle never fills gaps with invented prices — try a longer range.</span>
          </div>
        ) : (
          <motion.div className="h-full" animate={{ opacity: isPlaceholderData ? 0.45 : 1 }} transition={{ duration: 0.2 }} role="img" aria-label={`Price history for ${visible.map((v) => v.name).join(", ")}. Table view available.`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={[win.from, win.to]} tickFormatter={fmtTick} tickLine={false} axisLine={false} minTickGap={56} tickMargin={8} />
                <YAxis domain={[Math.max(0, minV - pad), maxV + pad]} tickFormatter={(v) => formatMoney(v, currency, undefined, { compact: v >= 1e7 })} tickLine={false} axisLine={false} width={72} tickCount={5} />
                <Tooltip
                  cursor={{ stroke: "var(--ink-4)", strokeWidth: 1 }}
                  isAnimationActive={false}
                  content={({ active, label }) => {
                    if (!active || label === undefined) return null;
                    const t = Number(label);
                    return (
                      <ChartTooltip
                        title={fmtFull(t)}
                        rows={visible
                          .map((s) => ({ s, v: stepValue(s.points, t) }))
                          .sort((a, b) => (a.v ?? Infinity) - (b.v ?? Infinity))
                          .map(({ s, v }) => ({ key: s.variantId, color: colors.get(s.variantId)!.color, dash: colors.get(s.variantId)!.dash, label: s.name, value: v === null ? "unknown" : money(v), muted: v === null }))}
                        footer="Value in effect at this time · gaps = no trustworthy reading"
                      />
                    );
                  }}
                />
                {visible.map((s) => {
                  const c = colors.get(s.variantId)!;
                  return (
                    <Line
                      key={s.variantId}
                      type="stepAfter"
                      dataKey={s.variantId}
                      name={s.name}
                      stroke={c.color}
                      strokeWidth={s.isReference && effColorBy === "brand" ? 2.4 : 2}
                      strokeDasharray={c.dash !== "0" ? c.dash : undefined}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--chart-surface)" }}
                      connectNulls={false}
                      isAnimationActive={!reduce && rows.length < 4000}
                      animationDuration={600}
                      animationEasing="ease-out"
                    />
                  );
                })}
                {eventsShown &&
                  visible.flatMap((s) =>
                    s.events
                      .filter((e) => e.kind !== "discount_ended")
                      .map((e, i) => {
                        const y = e.to ?? e.from;
                        if (y === null) return null;
                        const st = EVENT_STYLE[e.kind] ?? EVENT_STYLE.seller_change!;
                        return <ReferenceDot key={`${s.variantId}-${i}`} x={e.t} y={y} r={e.kind === "out_of_stock" || e.kind === "back_in_stock" ? 4.5 : 3} fill={e.kind === "out_of_stock" ? "var(--chart-surface)" : st.fill} stroke={st.fill} strokeWidth={e.kind === "out_of_stock" ? 2 : 1.5} ifOverflow="hidden" />;
                      }),
                  )}
                {rows.length > 40 && !compact && <Brush dataKey="t" height={22} travellerWidth={8} stroke="var(--line-strong)" fill="var(--surface-2)" tickFormatter={fmtTick} />}
              </ComposedChart>
            </ResponsiveContainer>
          </motion.div>
        )}
      </div>

      {excluded.length > 0 && <p className="text-xs text-warn">{excluded.length} series priced in another currency ({[...new Set(excluded.map((e) => e.currency))].join(", ")}) aren't drawn on this axis — Aisle never mixes currencies.</p>}
      {eventsShown && visible.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-3">
          {["decrease", "increase", "out_of_stock", "back_in_stock"].map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: k === "out_of_stock" ? "transparent" : EVENT_STYLE[k]!.fill, boxShadow: `inset 0 0 0 1.5px ${EVENT_STYLE[k]!.fill}` }} />
              {EVENT_STYLE[k]!.label}
            </span>
          ))}
        </div>
      )}

      {/* Statistics — always visible numbers, not hover-only */}
      {visible.length > 0 && (
        <div className="overflow-x-auto rounded-[14px] shadow-[var(--ring-inset)]">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-3">
                {["Series", "Min", "Max", "Median", "Avg (time-wtd)", "Changes", "Volatility", "Discounted", "Coverage", "Last change"].map((h, i) => (
                  <th key={h} className={cn("px-3 py-2.5 font-semibold", i > 0 && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.variantId} className="hairline-t">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <svg width="14" height="4" aria-hidden><line x1="0" y1="2" x2="14" y2="2" stroke={colors.get(s.variantId)!.color} strokeWidth="2.5" strokeDasharray={colors.get(s.variantId)!.dash !== "0" ? colors.get(s.variantId)!.dash : undefined} /></svg>
                      <span className="truncate font-medium">{s.name}</span>
                    </span>
                  </td>
                  <td className="num px-3 py-2 text-right">{s.stats.min !== null ? money(s.stats.min) : "—"}</td>
                  <td className="num px-3 py-2 text-right">{s.stats.max !== null ? money(s.stats.max) : "—"}</td>
                  <td className="num px-3 py-2 text-right">{s.stats.median !== null ? money(s.stats.median) : "—"}</td>
                  <td className="num px-3 py-2 text-right">{s.stats.timeWeightedAvg !== null ? money(Math.round(s.stats.timeWeightedAvg)) : "—"}</td>
                  <td className="num px-3 py-2 text-right">{s.stats.changeCount}</td>
                  <td className="num px-3 py-2 text-right" title="Standard deviation of relative price-change sizes">{s.stats.volatility !== null ? formatPct(s.stats.volatility) : "—"}</td>
                  <td className="num px-3 py-2 text-right" title="Share of known, priced time below list price or on a deal">{s.stats.discountedShare !== null ? formatPct(s.stats.discountedShare) : "—"}</td>
                  <td className={cn("num px-3 py-2 text-right", s.stats.coverage < 0.6 && "text-warn")} title="Share of the window with a trustworthy reading">{formatPct(s.stats.coverage)}</td>
                  <td className="px-3 py-2 text-right text-xs text-ink-2">{s.stats.lastChangeAt ? new Date(s.stats.lastChangeAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence initial={false}>
        {showTable && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={spring.layout} className="overflow-hidden">
            <div className="max-h-[360px] overflow-auto rounded-[14px] shadow-[var(--ring-inset)]">
              <table className="w-full text-sm">
                <caption className="sr-only">Observations in the selected window</caption>
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-left text-2xs uppercase tracking-wide text-ink-3">
                    <th className="px-3 py-2.5 font-semibold">Observed at</th>
                    <th className="px-3 py-2.5 font-semibold">Series</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {visible
                    .flatMap((s) => s.raw.map((p) => ({ s, p })))
                    .sort((a, b) => b.p.t - a.p.t)
                    .slice(0, 500)
                    .map(({ s, p }) => (
                      <tr key={`${s.variantId}-${p.t}`} className="hairline-t">
                        <td className="num px-3 py-1.5 text-xs text-ink-2">{fmtFull(p.t)}</td>
                        <td className="px-3 py-1.5 text-xs">{s.name}</td>
                        <td className="num px-3 py-1.5 text-right text-xs">{p.price === null ? <span className="text-bad">unavailable</span> : money(p.price)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-2xs text-ink-3">Latest 500 stored observations. Data rendered {data ? new Date(data.renderedAt).toLocaleTimeString() : "—"}.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
