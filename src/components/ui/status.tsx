"use client";

import { AlertTriangle, CheckCircle2, Clock, FlaskConical, MousePointerClick, PauseCircle, RefreshCw, XCircle } from "lucide-react";
import { FRESHNESS_COPY, relativeTime, type FreshnessState } from "@/lib/freshness";
import { MARKETPLACES, isMarketplaceCode } from "@/lib/marketplaces";
import { cn } from "@/lib/cn";
import { Badge } from "./badge";
import { Tooltip } from "./tooltip";

const FRESH_STYLE: Record<FreshnessState, { dot: string; icon: typeof CheckCircle2; tone: "good" | "warn" | "bad" | "neutral" | "accent" }> = {
  verified: { dot: "bg-good", icon: CheckCircle2, tone: "good" },
  provider_stale: { dot: "bg-warn", icon: Clock, tone: "warn" },
  pending: { dot: "bg-accent", icon: RefreshCw, tone: "accent" },
  failed: { dot: "bg-bad", icon: XCircle, tone: "bad" },
  paused: { dot: "bg-ink-4", icon: PauseCircle, tone: "neutral" },
  unavailable: { dot: "bg-ink-4", icon: AlertTriangle, tone: "neutral" },
};

/** Freshness: icon + label (never color alone), with the four clocks in the tooltip. */
export function Freshness({ state, lastSuccessAt, providerUpdatedAt, observedAt, nextCheckAt, variant = "dot", className }: { state: FreshnessState; lastSuccessAt?: string | null; providerUpdatedAt?: string | null; observedAt?: string | null; nextCheckAt?: string | null; variant?: "dot" | "badge"; className?: string }) {
  const s = FRESH_STYLE[state];
  const copy = FRESHNESS_COPY[state];
  const tip = (
    <div className="space-y-1">
      <div className="font-semibold">{copy.label}</div>
      <div className="opacity-80">{copy.description}</div>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 opacity-90">
        <dt className="opacity-70">Aisle checked</dt>
        <dd>{relativeTime(lastSuccessAt)}</dd>
        <dt className="opacity-70">Provider updated</dt>
        <dd>{providerUpdatedAt ? relativeTime(providerUpdatedAt) : "not reported"}</dd>
        <dt className="opacity-70">Price observed</dt>
        <dd>{relativeTime(observedAt)}</dd>
        {nextCheckAt && (
          <>
            <dt className="opacity-70">Next check</dt>
            <dd>{relativeTime(nextCheckAt)}</dd>
          </>
        )}
      </dl>
    </div>
  );
  if (variant === "badge") {
    const Icon = s.icon;
    return (
      <Tooltip content={tip}>
        <span tabIndex={0} className={cn("outline-none", className)}>
          <Badge tone={s.tone}>
            <Icon className="size-3" strokeWidth={2.4} aria-hidden />
            {copy.label}
          </Badge>
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={tip}>
      <span tabIndex={0} className={cn("inline-flex items-center gap-1.5 text-xs text-ink-3 outline-none", className)}>
        <span className={cn("size-[7px] rounded-full", s.dot)} aria-hidden />
        <span>{copy.label}</span>
      </span>
    </Tooltip>
  );
}

/**
 * `onImage`: product image tiles are always light (Amazon photos are shot on white), so a badge
 * placed on one uses fixed light-tile colours instead of the theme's — dark-mode amber on a white
 * tile is illegible.
 */
export function SimulatedBadge({ className, compact, onImage }: { className?: string; compact?: boolean; onImage?: boolean }) {
  return (
    <Tooltip content="Simulated demo data from Aisle's fictional catalog — not a real Amazon price.">
      <span tabIndex={0} className={cn("outline-none", className)}>
        <Badge tone="sim" size="xs" className={onImage ? "bg-[rgba(255,248,235,0.92)] text-[#8a5a00] shadow-[0_0_0_0.5px_rgba(138,90,0,0.18)] backdrop-blur-sm" : undefined}>
          <FlaskConical className="size-3" aria-hidden />
          {compact ? "Sim" : "Simulated"}
        </Badge>
      </span>
    </Tooltip>
  );
}

/** "14 Oct, 2:05 pm" in the viewer's time zone. Only rendered inside tooltips, after hydration. */
export function captureTime(at: string | number | Date) {
  return new Date(at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * A real price the owner captured from the Amazon.in product page with the bookmarklet.
 * Deliberately the opposite of SimulatedBadge: solid accent fill against Simulated's soft amber.
 */
export function CapturedBadge({ at, className, compact, onImage }: { at?: string | null; className?: string; compact?: boolean; onImage?: boolean }) {
  return (
    <Tooltip
      content={
        <div className="space-y-1">
          <div className="font-semibold">Captured from Amazon.in{at ? ` · ${captureTime(at)}` : ""}</div>
          <div className="opacity-80">A real price you captured from the product page with the Aisle bookmarklet{at ? ` ${relativeTime(at)}` : ""}. It shows what the page displayed at that moment — not simulated, and not updated until you capture again.</div>
        </div>
      }
    >
      <span tabIndex={0} className={cn("outline-none", className)}>
        <Badge tone="captured" size="xs" className={onImage ? "shadow-[0_1px_2px_rgba(0,0,0,0.18)]" : undefined}>
          <MousePointerClick className="size-3" aria-hidden />
          {compact ? "Captured" : "Captured price"}
        </Badge>
      </span>
    </Tooltip>
  );
}

/** The one provenance badge for a current price: Captured replaces Simulated, a live provider price needs none. */
export function PriceOriginBadge({ source, isSimulated, at, compact, onImage, className }: { source: string | null; isSimulated: boolean; at?: string | null; compact?: boolean; onImage?: boolean; className?: string }) {
  if (source === "user-capture") return <CapturedBadge at={at} compact={compact} onImage={onImage} className={className} />;
  if (isSimulated) return <SimulatedBadge compact={compact} onImage={onImage} className={className} />;
  return null;
}

export function MarketplaceTag({ code, className, showName }: { code: string; className?: string; showName?: boolean }) {
  const mp = isMarketplaceCode(code) ? MARKETPLACES[code] : null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-ink-3", className)} title={mp?.name ?? code}>
      <span aria-hidden className="text-[13px] leading-none">{mp?.flag ?? "🌐"}</span>
      <span>{showName ? (mp?.name ?? code) : mp ? mp.domain.replace("www.", "") : code}</span>
    </span>
  );
}

export function StockBadge({ availability }: { availability: string }) {
  if (availability === "in_stock") return <span className="inline-flex items-center gap-1.5 text-xs text-ink-2"><span className="size-1.5 rounded-full bg-good" aria-hidden />In stock</span>;
  if (availability === "out_of_stock") return <Badge tone="bad" size="xs">Unavailable</Badge>;
  if (availability === "limited") return <Badge tone="warn" size="xs">Limited</Badge>;
  if (availability === "preorder") return <Badge tone="accent" size="xs">Pre-order</Badge>;
  return <span className="text-xs text-ink-4" title="The provider didn't report availability">Unknown</span>;
}
