"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatMoney, formatPct } from "@/lib/money";
import { cn } from "@/lib/cn";

export function Price({ minor, currency, className, muted }: { minor: number | null | undefined; currency: string | null | undefined; className?: string; muted?: boolean }) {
  if (minor === null || minor === undefined || !currency) return <span className={cn("num text-ink-4", className)} title="No price available">—</span>;
  return <span className={cn("num", muted && "text-ink-2", className)}>{formatMoney(minor, currency)}</span>;
}

/**
 * Direction-neutral change indicator: ▼ teal for decreases, ▲ amber for
 * increases (a competitor's drop isn't "good" for everyone). Arrow + sign
 * always accompany color.
 */
export function Delta({ ratio, className, size = "sm", showZero = true, title }: { ratio: number | null | undefined; className?: string; size?: "xs" | "sm" | "md"; showZero?: boolean; title?: string }) {
  if (ratio === null || ratio === undefined) return <span className={cn("num text-ink-4", className)} title={title ?? "Not enough observations in this window"}>—</span>;
  const zero = Math.abs(ratio) < 0.0005;
  if (zero && !showZero) return null;
  const Icon = zero ? Minus : ratio < 0 ? ArrowDownRight : ArrowUpRight;
  const sizes = { xs: "text-2xs gap-0.5 [&>svg]:size-3", sm: "text-xs gap-0.5 [&>svg]:size-3.5", md: "text-sm gap-1 [&>svg]:size-4" };
  return (
    <span title={title} className={cn("num inline-flex items-center font-medium", sizes[size], zero ? "text-ink-3" : ratio < 0 ? "text-down" : "text-up", className)}>
      <Icon strokeWidth={2.4} aria-hidden />
      <span>{zero ? "0%" : formatPct(Math.abs(ratio))}</span>
      <span className="sr-only">{zero ? "unchanged" : ratio < 0 ? "decrease" : "increase"}</span>
    </span>
  );
}
