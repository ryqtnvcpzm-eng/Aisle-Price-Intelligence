"use client";

import { useReducedMotion } from "motion/react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "./chart-tooltip";

export interface IndexPoint {
  t: number;
  reference: number | null;
  competitors: number | null;
}

/** Direct label at the series' last point (identity is never carried by color alone). */
function endLabel(n: number, text: string, strong: boolean) {
  function EndLabel(props: { x?: number | string; y?: number | string; index?: number }) {
    if (props.index !== n - 1 || props.x === undefined || props.y === undefined) return null;
    return (
      <text x={Number(props.x) + 8} y={Number(props.y) + 4} fontSize={11} fontWeight={strong ? 600 : 400} fill={strong ? "var(--ink)" : "var(--ink-2)"}>
        {text}
      </text>
    );
  }
  return EndLabel;
}

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Portfolio price index (100 = each listing's price 30 days ago), reference
 * brand vs competitor median. One axis, two series, direct end labels.
 */
export function IndexTrendChart({ data, height = 220, referenceLabel = "Your brand" }: { data: IndexPoint[]; height?: number; referenceLabel?: string }) {
  const reduce = useReducedMotion();
  const vals = data.flatMap((d) => [d.reference, d.competitors]).filter((v): v is number => v !== null);
  if (vals.length < 2) {
    return <div className="flex items-center justify-center text-sm text-ink-3" style={{ height }}>Not enough history yet — the index appears after a few days of monitoring.</div>;
  }
  const lo = Math.floor(Math.min(...vals, 100) - 1);
  const hi = Math.ceil(Math.max(...vals, 100) + 1);
  const last = data.at(-1);
  return (
    <div style={{ height }} className="relative" role="img" aria-label={`Price index over 30 days. ${referenceLabel} now ${last?.reference?.toFixed(1) ?? "n/a"}, competitors ${last?.competitors?.toFixed(1) ?? "n/a"} (100 = 30 days ago).`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 76, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} strokeDasharray="0" />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={fmtDate} tickLine={false} axisLine={false} minTickGap={48} tickMargin={8} />
          <YAxis domain={[lo, hi]} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}`} tickCount={4} />
          <ReferenceLine y={100} stroke="var(--chart-axis)" strokeDasharray="3 3" />
          <Tooltip
            cursor={{ stroke: "var(--ink-4)", strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <ChartTooltip
                  title={fmtDate(Number(label))}
                  rows={[
                    { key: "r", color: "var(--series-1)", label: referenceLabel, value: payload.find((p) => p.dataKey === "reference")?.value != null ? Number(payload.find((p) => p.dataKey === "reference")!.value).toFixed(1) : "—" },
                    { key: "c", color: "var(--series-2)", label: "Competitor median", value: payload.find((p) => p.dataKey === "competitors")?.value != null ? Number(payload.find((p) => p.dataKey === "competitors")!.value).toFixed(1) : "—" },
                  ]}
                  footer="Index: 100 = each listing's own price 30 days ago"
                />
              ) : null
            }
          />
          <Line type="linear" dataKey="competitors" stroke="var(--series-2)" strokeWidth={2} dot={false} label={endLabel(data.length, "Competitors", false)} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--chart-surface)" }} isAnimationActive={!reduce} animationDuration={700} connectNulls={false} />
          <Line type="linear" dataKey="reference" stroke="var(--series-1)" strokeWidth={2.25} dot={false} label={endLabel(data.length, referenceLabel, true)} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--chart-surface)" }} isAnimationActive={!reduce} animationDuration={700} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
