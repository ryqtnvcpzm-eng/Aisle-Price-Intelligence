"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bookmark, Check, ClipboardCopy, Info, KeyRound, MousePointerClick, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { bookmarkletHref } from "@/lib/capture/bookmarklet";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/freshness";
import { formatMoney } from "@/lib/money";
import { spring } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { EmptyState } from "../ui/empty-state";
import { CapturedBadge, captureTime } from "../ui/status";

export interface CaptureRow {
  id: string;
  status: string;
  asin: string;
  title: string | null;
  priceMinor: number | null;
  currency: string;
  isDeal: boolean;
  selector: string | null;
  variantLabel: string | null;
  availabilityText: string | null;
  capturedAt: string;
  familyId: string | null;
  aisleVariant: string | null;
  familyTitle: string | null;
  variantId: string | null;
}

interface TokenStatus {
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const noop = () => () => {};
/** True after hydration: absolute and relative times render only in the browser's own locale and clock. */
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

export function CaptureSettings({ appUrl, canCapture, token, captures }: { appUrl: string; canCapture: boolean; token: TokenStatus | null; captures: CaptureRow[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  // The plaintext token lives only in this component's memory, only until the page is left.
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"regenerate" | "revoke" | null>(null);

  async function generate() {
    setBusy(true);
    try {
      const r = await api<{ token: string; prefix: string; createdAt: string }>("/api/capture/token", { method: "POST" });
      setFresh(r.token);
      setConfirm(null);
      toast.success(token ? "New token created — your old bookmarklet no longer works" : "Capture token created");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't create a token.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await api("/api/capture/token", { method: "DELETE" });
      setFresh(null);
      setConfirm(null);
      toast.success("Token revoked — the bookmarklet stops working");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't revoke the token.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        {/* 1 · Token */}
        <section className="card overflow-hidden">
          <Header n={1} title="Your capture token" description="The bookmarklet carries this token so Aisle knows the capture is yours. It can only record captures into this workspace — nothing else." />
          <div className="space-y-4 px-5 pb-5">
            {!canCapture ? (
              <Note tone="warn">Viewers can’t record captures. Ask a workspace owner for analyst access.</Note>
            ) : fresh ? (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.snappy} className="space-y-2.5">
                <Note tone="accent">
                  <span className="font-semibold">Copy it now if you need it — this is the only time it’s shown.</span> Aisle keeps only a SHA-256 fingerprint and can’t show it again. The bookmarklet below already contains it.
                </Note>
                <TokenField token={fresh} />
              </motion.div>
            ) : token ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-good-soft text-good"><ShieldCheck className="size-4" aria-hidden /></span>
                  <div className="min-w-0 text-sm">
                    <div className="num font-medium">{token.prefix}…</div>
                    <div className="text-xs text-ink-3">{hydrated ? `Created ${relativeTime(token.createdAt)} · ${token.lastUsedAt ? `last used ${relativeTime(token.lastUsedAt)}` : "not used yet"}` : " "}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setConfirm("regenerate")}><RefreshCw className="size-3.5" /> Regenerate</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm("revoke")}><Trash2 className="size-3.5" /> Revoke</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-ink-2">No token yet. Create one to get your bookmarklet.</p>
                <Button variant="primary" size="md" loading={busy} onClick={generate}><KeyRound className="size-4" /> Generate token</Button>
              </div>
            )}
            {fresh && (
              <div className="flex justify-end">
                <Button size="sm" variant="ghost" onClick={() => setConfirm("regenerate")}><RefreshCw className="size-3.5" /> Regenerate</Button>
              </div>
            )}
          </div>
        </section>

        {/* 2 · Bookmarklet */}
        <section className="card overflow-hidden">
          <Header n={2} title="Install the bookmarklet" description="Drag the button to your browser's bookmarks bar. Then, on any Amazon.in product page, click it once." />
          <div className="space-y-4 px-5 pb-5">
            <AnimatePresence mode="wait" initial={false}>
              {fresh ? (
                <motion.div key="ready" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.snappy}>
                  <BookmarkletInstall appUrl={appUrl} token={fresh} />
                </motion.div>
              ) : (
                <motion.div key="locked" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-3 rounded-[14px] bg-surface-2 px-4 py-3.5 text-sm text-ink-2 shadow-[var(--ring-inset)]">
                  <Bookmark className="size-4 shrink-0 text-ink-3" aria-hidden />
                  {token
                    ? "Your bookmarklet is installed with the current token. To install it on another browser, regenerate the token — the old bookmarklet stops working."
                    : "The bookmarklet appears here once you've generated a token."}
                </motion.div>
              )}
            </AnimatePresence>
            <ol className="grid gap-2 text-sm text-ink-2 sm:grid-cols-3">
              {[
                ["Show the bookmarks bar", "Chrome / Edge: ⌘⇧B or Ctrl+Shift+B. Safari: View → Show Favorites Bar. Firefox: View → Toolbars."],
                ["Drag the blue button onto it", "Or copy the code, add any bookmark, and paste the code as its URL."],
                ["Open a product on amazon.in", "Pick the size or flavour you want first, then click “Aisle capture”."],
              ].map(([t, d], i) => (
                <li key={t} className="rounded-[12px] bg-surface-2 px-3.5 py-3 shadow-[var(--ring-inset)]">
                  <div className="flex items-center gap-2 font-medium text-ink"><span className="num flex size-5 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent">{i + 1}</span>{t}</div>
                  <p className="mt-1 text-xs text-ink-3">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 3 · Recent captures */}
        <section className="card overflow-hidden">
          <Header title="Recent captures" description="The last 25 captures from everyone in this workspace." />
          {captures.length === 0 ? (
            <EmptyState compact icon={<MousePointerClick />} title="Nothing captured yet" description="Captures appear here the moment you click the bookmarklet on a product page." className="pb-6" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-2xs uppercase tracking-wide text-ink-3 hairline-b">
                    <th className="px-5 py-2.5 font-semibold">Captured</th>
                    <th className="px-3 py-2.5 font-semibold">Product</th>
                    <th className="whitespace-nowrap px-3 py-2.5 font-semibold">Variant on page</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Price</th>
                    <th className="whitespace-nowrap px-5 py-2.5 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {captures.map((c) => (
                    <tr key={c.id} className="hairline-b last:shadow-none">
                      <td className="whitespace-nowrap px-5 py-2.5 text-xs text-ink-2">
                        <time dateTime={c.capturedAt} title={hydrated ? new Date(c.capturedAt).toLocaleString() : undefined}>{hydrated ? captureTime(c.capturedAt) : " "}</time>
                      </td>
                      <td className="max-w-[240px] px-3 py-2.5">
                        {c.familyId ? (
                          <Link href={`/products/${c.familyId}${c.variantId ? `?variant=${c.variantId}` : ""}`} className="block truncate font-medium hover:text-accent">
                            {c.familyTitle?.split(",")[0]}{c.aisleVariant ? ` · ${c.aisleVariant}` : ""}
                          </Link>
                        ) : (
                          <span className="block truncate font-medium text-ink-2">{c.title ?? "Untitled page"}</span>
                        )}
                        <span className="num text-2xs text-ink-3">{c.asin}</span>
                      </td>
                      <td className="max-w-[140px] px-3 py-2.5 text-xs text-ink-2">{c.variantLabel ?? <span className="text-ink-4">None selected</span>}</td>
                      <td className="num whitespace-nowrap px-3 py-2.5 text-right">
                        {c.priceMinor === null ? (
                          <span className="block text-xs text-ink-3" title={c.availabilityText ?? undefined}>
                            No price
                            {c.availabilityText && <span className="block max-w-[140px] truncate text-2xs text-ink-4">{c.availabilityText}</span>}
                          </span>
                        ) : (
                          <span className="font-semibold">
                            {formatMoney(c.priceMinor, c.currency)}
                            {c.isDeal && <Badge tone="down" size="xs" className="ml-1.5 align-middle">Deal</Badge>}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-2.5">
                        <CaptureStatus row={c} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Limitations */}
      <aside className="space-y-4">
        <section className="card p-5">
          <div className="flex items-center gap-2 text-sm font-semibold"><Info className="size-4 text-accent" aria-hidden /> Good to know</div>
          <ul className="mt-3 space-y-3 text-sm text-ink-2">
            <li><span className="font-medium text-ink">One page per click.</span> The bookmarklet reads only the page you’re looking at, only when you click it. It never runs on its own, never opens other pages, and Aisle never fetches anything from Amazon.</li>
            <li><span className="font-medium text-ink">Select the variant first.</span> Choose the size or flavour on Amazon before clicking. Aisle matches the capture by the ASIN in the page address, which changes with the selection.</li>
            <li><span className="font-medium text-ink">A snapshot, not monitoring.</span> A captured price is what that page showed you at that moment — for your location, account and any offer you were shown. It isn’t updated until you capture again.</li>
            <li><span className="font-medium text-ink">Labelled everywhere.</span> Captured prices carry <CapturedBadge compact className="inline-flex align-middle" /> and appear as ◆ markers on charts. A simulated reading never replaces a captured one.</li>
            <li><span className="font-medium text-ink">No price on the page?</span> Out-of-stock or overlay pages are still recorded, with the availability text and no price — never as zero.</li>
            <li><span className="font-medium text-ink">Not tracked yet?</span> Aisle offers to import the product, then you can capture again.</li>
          </ul>
        </section>
      </aside>

      <Dialog
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        size="sm"
        title={confirm === "revoke" ? "Revoke capture token?" : "Regenerate capture token?"}
        description={confirm === "revoke" ? "The bookmarklet stops working right away. Captures you already made stay." : "Your current bookmarklet stops working right away. You'll install a new one with the new token."}
      >
        <div className="flex justify-end gap-2 px-6 pb-5 pt-5">
          <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          {confirm === "revoke" ? (
            <Button variant="destructive" loading={busy} onClick={revoke}>Revoke token</Button>
          ) : (
            <Button variant="primary" loading={busy} onClick={generate}>Regenerate</Button>
          )}
        </div>
      </Dialog>
    </div>
  );
}

function Header({ n, title, description }: { n?: number; title: string; description: string }) {
  return (
    <header className="flex items-start gap-3 px-5 pb-4 pt-4">
      {n && <span className="num mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-ink">{n}</span>}
      <div>
        <h2 className="text-md font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 max-w-[620px] text-xs text-ink-3">{description}</p>
      </div>
    </header>
  );
}

function Note({ tone, children }: { tone: "accent" | "warn"; children: React.ReactNode }) {
  return <div className={cn("rounded-[12px] px-4 py-3 text-sm", tone === "accent" ? "bg-accent-softer text-ink-2" : "bg-warn-soft text-ink-2")}>{children}</div>;
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(key: string, text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      toast.success(message);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } catch {
      toast.error("Couldn't copy — select the text and copy it instead.");
    }
  }
  return { copied, copy };
}

function TokenField({ token }: { token: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={token} aria-label="Capture token" onFocus={(e) => e.currentTarget.select()} className="num h-9 min-w-0 flex-1 rounded-[9px] bg-surface-2 px-3 text-xs text-ink shadow-[inset_0_0_0_0.5px_var(--line-strong)] outline-none focus-visible:shadow-[0_0_0_2px_var(--focus)]" />
      <Button size="md" variant="secondary" onClick={() => copy("token", token, "Token copied")}>
        {copied === "token" ? <Check className="size-4 text-good" /> : <ClipboardCopy className="size-4" />} {copied === "token" ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function BookmarkletInstall({ appUrl, token }: { appUrl: string; token: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const href = useMemo(() => bookmarkletHref({ appUrl, token }), [appUrl, token]);
  const { copied, copy } = useCopy();
  // React refuses to render `javascript:` URLs, so the bookmark target is set on the element directly.
  useEffect(() => {
    ref.current?.setAttribute("href", href);
  }, [href]);
  return (
    <div className="flex flex-col items-start gap-3 rounded-[16px] bg-accent-softer p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <motion.a
          ref={ref}
          draggable
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.97 }}
          transition={spring.press}
          onClick={(e) => {
            e.preventDefault();
            toast.info("Drag this button to your bookmarks bar — it only works on Amazon.in product pages.");
          }}
          className="inline-flex h-10 cursor-grab select-none items-center gap-2 rounded-[11px] bg-accent px-4 text-sm font-semibold text-accent-ink shadow-[0_4px_14px_-4px_var(--accent),inset_0_0.5px_0_rgba(255,255,255,0.25)] active:cursor-grabbing"
          title="Drag me to your bookmarks bar"
        >
          <MousePointerClick className="size-4" aria-hidden /> Aisle capture
        </motion.a>
        <span className="text-xs text-ink-2">← drag to your bookmarks bar</span>
      </div>
      <Button size="sm" variant="ghost" onClick={() => copy("code", href, "Bookmarklet code copied — paste it as a bookmark's URL")}>
        {copied === "code" ? <Check className="size-3.5 text-good" /> : <ClipboardCopy className="size-3.5" />} Copy code
      </Button>
    </div>
  );
}

function CaptureStatus({ row }: { row: CaptureRow }) {
  if (row.status === "recorded") return <Badge tone="good" size="xs"><Check className="size-3" aria-hidden /> Recorded</Badge>;
  if (row.status === "duplicate") return <Badge size="xs" title="Same price and availability as a capture moments earlier — not recorded twice">Already captured</Badge>;
  return (
    <span className="flex items-center gap-2">
      <Badge tone="warn" size="xs">Not tracked</Badge>
      <Link href={`/products?import=${encodeURIComponent(`https://www.amazon.in/dp/${row.asin}`)}`} className="text-xs font-medium text-accent hover:text-accent-hover">Import →</Link>
    </span>
  );
}
