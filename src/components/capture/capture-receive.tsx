"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, MousePointerClick } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { api, ApiError } from "@/lib/api";
import type { CapturePayload } from "@/lib/capture/bookmarklet";
import { formatMoney } from "@/lib/money";
import { spring } from "../motion/tokens";
import { Button } from "../ui/button";

type Result =
  | { kind: "recorded"; variant: string | null; familyId: string | null; duplicate: boolean }
  | { kind: "untracked"; importUrl: string }
  | { kind: "error"; message: string; signIn?: boolean };

/**
 * Read the capture from the URL fragment once, then drop it from the address bar
 * so it isn't kept in history. Cached at module level: the fragment is gone after
 * the first read, and every later render must see the same value.
 */
let cached: { payload: CapturePayload | null } | null = null;
function readFragment(): CapturePayload | null {
  if (cached) return cached.payload;
  let payload: CapturePayload | null = null;
  try {
    const raw = decodeURIComponent(window.location.hash.slice(1));
    const v = raw ? (JSON.parse(raw) as Partial<CapturePayload>) : null;
    if (v && typeof v.asin === "string" && typeof v.url === "string" && (v.priceMinor === null || typeof v.priceMinor === "number")) payload = v as CapturePayload;
  } catch {
    payload = null;
  }
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  cached = { payload };
  return payload;
}
const noop = () => () => {};

export function CaptureReceive() {
  // undefined on the server and during hydration; null when the fragment held nothing usable.
  const payload = useSyncExternalStore(noop, readFragment, () => undefined);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // Recording needs a click here: a link someone else crafted can't record a capture on your behalf.
  async function record(p: CapturePayload) {
    setBusy(true);
    try {
      const r = await api<{ capture: { variant: string; familyId: string; duplicate: boolean } }>("/api/capture", { method: "POST", body: p });
      setResult({ kind: "recorded", variant: r.capture.variant ?? null, familyId: r.capture.familyId ?? null, duplicate: Boolean(r.capture.duplicate) });
    } catch (e) {
      // The capture endpoint's only 404 is { error: "untracked_asin" }.
      if (e instanceof ApiError && e.status === 404) setResult({ kind: "untracked", importUrl: `/products?import=${encodeURIComponent(`https://www.amazon.in/dp/${p.asin}`)}` });
      else if (e instanceof ApiError && e.status === 401) setResult({ kind: "error", message: "Your Aisle session has expired. Sign in, then click the bookmarklet again.", signIn: true });
      else setResult({ kind: "error", message: e instanceof ApiError ? e.message : "Couldn't reach Aisle." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.gentle} className="card w-full max-w-[400px] p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-7 items-center justify-center rounded-[8px] bg-accent text-accent-ink"><MousePointerClick className="size-3.5" aria-hidden /></span>
          Aisle capture
        </div>
        {payload === undefined ? (
          <div className="mt-4 h-24" />
        ) : payload === null ? (
          <p className="mt-4 text-sm text-ink-2">Nothing to record. Open an Amazon.in product page and click the bookmarklet there.</p>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {!result ? (
              <motion.div key="confirm" exit={{ opacity: 0 }} className="mt-4 space-y-4">
                <p className="text-xs text-ink-3">Amazon’s page blocked the direct request, so the capture opened here instead. Check it and record it with your Aisle session.</p>
                <dl className="space-y-1.5 rounded-[12px] bg-surface-2 px-4 py-3 text-sm shadow-[var(--ring-inset)]">
                  <div className="line-clamp-2 font-medium">{payload.title ?? payload.asin}</div>
                  <div className="num text-lg font-semibold">{payload.priceMinor === null ? <span className="text-sm font-normal text-ink-3">No price on the page{payload.availability ? ` · ${payload.availability}` : ""}</span> : formatMoney(payload.priceMinor, "INR")}{payload.isDeal && <span className="ml-2 text-xs font-medium text-down">deal</span>}</div>
                  <div className="text-xs text-ink-3"><span className="num">{payload.asin}</span>{payload.variantLabel ? ` · ${payload.variantLabel}` : ""}{payload.availability && payload.priceMinor !== null ? ` · ${payload.availability}` : ""}</div>
                </dl>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => window.close()}>Cancel</Button>
                  <Button variant="primary" loading={busy} onClick={() => record(payload)}>Record capture</Button>
                </div>
              </motion.div>
            ) : (
              <motion.div key="done" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={spring.snappy} className="mt-4 space-y-4 text-sm" role="status">
                {result.kind === "recorded" && (
                  <p className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />{result.duplicate ? "Already captured a moment ago — not recorded twice." : `Captured${result.variant ? ` for ${result.variant}` : ""}.`}</p>
                )}
                {result.kind === "untracked" && <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />{payload.asin} isn’t tracked in Aisle yet.</p>}
                {result.kind === "error" && <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />{result.message}</p>}
                <div className="flex justify-end gap-2">
                  {result.kind === "recorded" && result.familyId && <Link href={`/products/${result.familyId}`} className="inline-flex h-8 items-center rounded-[9px] px-3 text-sm font-medium text-accent hover:bg-accent-softer">Open product</Link>}
                  {result.kind === "untracked" && <Link href={result.importUrl} className="inline-flex h-8 items-center rounded-[9px] bg-accent px-3 text-sm font-medium text-accent-ink">Import this product →</Link>}
                  {result.kind === "error" && result.signIn && <Link href="/sign-in" className="inline-flex h-8 items-center rounded-[9px] px-3 text-sm font-medium text-accent hover:bg-accent-softer">Sign in</Link>}
                  <Button variant="secondary" onClick={() => window.close()}>Close</Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.div>
    </main>
  );
}
