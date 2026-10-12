"use client";

import { useReducedMotion } from "motion/react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, formatPct, pctChange } from "@/lib/money";
import type { ComparisonResult } from "@/lib/comparison";
import type { GroupItemRow } from "@/server/comparison/service";
import { ChartTooltip } from "../charts/chart-tooltip";
import { SectionHeader } from "../ui/empty-state";

interface Props {
  result: ComparisonResult;
  items: GroupItemRow[];
  colorFor: (brand: string | null) => string;
  unitLabel: string;
}

/**
 * Visual view: four honest charts, one measure each, one axis each.
 * Every bar is direct-labelled so identity never relies on color.
 */
export function ComparisonVisual({ result, items, colorFor, unitLabel }: Props) {
  const reduce = useReducedMotion();
  const cur = result.currency ?? "INR";
  const comp = result.rows.filter((r) => r.comparable).sort((a, b) => a.unitPriceMinor! - b.unitPriceMinor!);
  const data = comp.map((r) => ({ id: r.id, name: `${r.brandName ?? ""} · ${r.label}`, brand: r.brandName, unit: r.unitPriceMinor!, premium: r.premium, role: r.role, ch7: pctChange(items.find((i) => i.variantId === r.id)?.p7 ?? null, r.priceMinor) }));
  const h = Math.max(180, data.length * 34 + 40);
  const median = result.competitorMedian;

  if (data.length < 2) return <p className="py-16 text-center text-sm text-ink-3">Visual comparisons need at least two comparable listings.</p>;

  const barCommon = { isAnimationActive: !reduce, animationDuration: 550, animationEasing: "ease-out" as const };
  const tip = (title: string, rows: { label: string; value: string; color: string }[]) => <ChartTooltip title={title} rows={rows.map((r, i) => ({ key: String(i), ...r }))} />;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="card p-5">
        <SectionHeader title={`Unit price ${unitLabel}`} description="Ranked cheapest first. Dashed line = competitor median." />
        <div className="mt-4" style={{ height: h }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 90, bottom: 4, left: 4 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" domain={[0, "dataMax"]} tickFormatter={(v) => formatMoney(v, cur)} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={170} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              {median !== null && <ReferenceLine x={median} stroke="var(--ink-3)" strokeDasharray="4 3" label={{ value: "median", position: "top", fill: "var(--ink-3)", fontSize: 10 }} />}
              <Tooltip cursor={{ fill: "var(--hairline)" }} isAnimationActive={false} content={({ active, payload }) => (active && payload?.[0] ? tip(String(payload[0].payload.name), [{ label: unitLabel, value: formatMoney(payload[0].payload.unit, cur, undefined, { trimZeros: false }), color: colorFor(payload[0].payload.brand) }, { label: "vs competitor median", value: formatPct(payload[0].payload.premium, { signed: true }), color: "var(--ink-4)" }]) : null)} />
              <Bar dataKey="unit" radius={[0, 4, 4, 0]} {...barCommon}>
                {data.map((d) => <Cell key={d.id} fill={colorFor(d.brand)} fillOpacity={d.role === "reference" ? 1 : 0.82} />)}
                <LabelList dataKey="unit" position="right" formatter={(v) => formatMoney(Number(v), cur, undefined, { trimZeros: false })} style={{ fontSize: 11, fill: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card p-5">
        <SectionHeader title="Relative to competitor median" description="Premium (▲) or discount (▼) on a normalized basis." />
        <div className="mt-4" style={{ height: h }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.map((d) => ({ ...d, p: (d.premium ?? 0) * 100 }))} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}%`} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={170} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <ReferenceLine x={0} stroke="var(--chart-axis)" />
              <Tooltip cursor={{ fill: "var(--hairline)" }} isAnimationActive={false} content={({ active, payload }) => (active && payload?.[0] ? tip(String(payload[0].payload.name), [{ label: "vs median", value: formatPct(payload[0].payload.premium, { signed: true }), color: "var(--ink-3)" }]) : null)} />
              <Bar dataKey="p" radius={4} {...barCommon}>
                {data.map((d) => <Cell key={d.id} fill={(d.premium ?? 0) >= 0 ? "var(--up)" : "var(--down)"} fillOpacity={0.85} />)}
                <LabelList dataKey="p" position="right" formatter={(v) => `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(Math.abs(Number(v)) < 10 ? 1 : 0)}%`} style={{ fontSize: 11, fill: "var(--ink-2)" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card p-5">
        <SectionHeader title="Price distribution" description={`Each dot is a listing's unit price ${unitLabel}. Reference brand outlined.`} />
        <Strip data={data} cur={cur} colorFor={colorFor} median={median} />
      </section>

      <section className="card p-5">
        <SectionHeader title="Movement · 7 days" description="Change in each listing's price over the past week." />
        <div className="mt-4" style={{ height: h }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.map((d) => ({ ...d, c: d.ch7 === null ? null : d.ch7 * 100 }))} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}%`} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={170} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <ReferenceLine x={0} stroke="var(--chart-axis)" />
              <Bar dataKey="c" radius={4} {...barCommon}>
                {data.map((d) => <Cell key={d.id} fill={(d.ch7 ?? 0) >= 0 ? "var(--up)" : "var(--down)"} fillOpacity={0.85} />)}
                <LabelList dataKey="c" position="right" formatter={(v) => (v === null || v === undefined ? "n/a" : `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(1)}%`)} style={{ fontSize: 11, fill: "var(--ink-2)" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

function Strip({ data, cur, colorFor, median }: { data: { id: string; name: string; brand: string | null; unit: number; role: string }[]; cur: string; colorFor: (b: string | null) => string; median: number | null }) {
  const min = Math.min(...data.map((d) => d.unit));
  const max = Math.max(...data.map((d) => d.unit));
  const pos = (v: number) => (max === min ? 50 : 4 + ((v - min) / (max - min)) * 92);
  return (
    <div className="mt-6 px-2">
      <div className="relative h-24">
        <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--chart-axis)]" />
        {median !== null && <div className="absolute top-2 bottom-2 w-px border-l border-dashed border-ink-3" style={{ left: `${pos(median)}%` }} title="Competitor median" />}
        {data.map((d, i) => (
          <div key={d.id} className="group absolute -translate-x-1/2" style={{ left: `${pos(d.unit)}%`, top: `calc(50% - 7px + ${(i % 3) - 1} * 14px)` }} tabIndex={0} aria-label={`${d.name}: ${formatMoney(d.unit, cur, undefined, { trimZeros: false })}`}>
            <span className="block size-3.5 rounded-full ring-2 ring-[var(--chart-surface)]" style={{ background: d.role === "reference" ? "var(--chart-surface)" : colorFor(d.brand), boxShadow: d.role === "reference" ? `inset 0 0 0 3px ${colorFor(d.brand)}` : undefined }} />
            <span className="material pointer-events-none absolute bottom-5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-[8px] px-2 py-1 text-2xs group-hover:block group-focus:block">
              <span className="num font-semibold">{formatMoney(d.unit, cur, undefined, { trimZeros: false })}</span> <span className="text-ink-3">{d.name}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="num mt-1 flex justify-between text-2xs text-ink-3">
        <span>{formatMoney(min, cur, undefined, { trimZeros: false })}</span>
        {median !== null && <span>median {formatMoney(median, cur, undefined, { trimZeros: false })}</span>}
        <span>{formatMoney(max, cur, undefined, { trimZeros: false })}</span>
      </div>
    </div>
  );
}
