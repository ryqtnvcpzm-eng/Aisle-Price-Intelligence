"use client";

import type { ReactNode } from "react";

export interface TooltipRow {
  key: string;
  color: string;
  label: string;
  value: ReactNode;
  dash?: string;
  muted?: boolean;
}

/**
 * Shared chart tooltip: values lead (strong), series names follow (secondary),
 * line keys rather than filled boxes. Text is rendered as React text nodes —
 * never injected HTML — because labels come from provider data.
 */
export function ChartTooltip({ title, rows, footer }: { title: ReactNode; rows: TooltipRow[]; footer?: ReactNode }) {
  return (
    <div className="material pointer-events-none min-w-[180px] max-w-[320px] rounded-[12px] px-3 py-2.5 text-xs">
      <div className="mb-1.5 font-medium text-ink-2">{title}</div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            <svg width="14" height="4" aria-hidden className="shrink-0">
              <line x1="0" y1="2" x2="14" y2="2" stroke={r.color} strokeWidth="2.5" strokeDasharray={r.dash && r.dash !== "0" ? r.dash : undefined} strokeLinecap="round" />
            </svg>
            <span className="num font-semibold text-ink">{r.value}</span>
            <span className={r.muted ? "truncate text-ink-4" : "truncate text-ink-3"}>{r.label}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-2 border-t border-[var(--line)] pt-1.5 text-2xs text-ink-3">{footer}</div>}
    </div>
  );
}
