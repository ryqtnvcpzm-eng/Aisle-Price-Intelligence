"use client";

import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import { BarChart3, Bell, Moon, Package, Plus, RefreshCw, Search, Sun, Tag } from "lucide-react";
import { Dialog as RD } from "radix-ui";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { duration, spring } from "../motion/tokens";
import { Kbd } from "../ui/badge";
import { ProductImage } from "../ui/product-image";
import { MarketplaceTag } from "../ui/status";
import { useImport } from "../import/import-context";
import { NAV } from "./nav";
import { usePrefs } from "./preferences";

interface SearchResult {
  products: { id: string; title: string; brand: string | null; imageUrl: string | null; marketplace: string; variants: number }[];
  brands: string[];
  groups: { id: string; name: string; items: number }[];
}

const Ctx = createContext<{ open: () => void }>({ open: () => {} });
export const usePalette = () => useContext(Ctx);

const RECENTS_KEY = "aisle-recent-commands";

/**
 * ⌘K command palette: navigation, product/brand/comparison search, and common
 * actions. cmdk provides the listbox semantics + arrow/enter handling; Radix
 * Dialog provides focus trap and escape.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [recents, setRecents] = useState<{ label: string; href: string }[]>([]);
  const router = useRouter();
  const importer = useImport();
  const { resolvedTheme, setTheme } = usePrefs();
  const seq = useRef<string[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 120);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    try {
      setRecents(JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]"));
    } catch {
      /* ignore */
    }
  }, [open]);

  // Global shortcuts: ⌘K palette, N add product, "g x" go-to sequences.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n" || e.key === "N") {
        if (document.querySelector("[role=dialog]")) return;
        e.preventDefault();
        importer.open();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      seq.current = [...seq.current, e.key.toLowerCase()].slice(-2);
      const combo = seq.current.join(" ");
      const hit = NAV.find((n) => n.key === combo);
      if (hit) {
        seq.current = [];
        router.push(hit.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, importer]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api<SearchResult>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: open,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });

  const go = useCallback(
    (href: string, label: string) => {
      setOpen(false);
      setQuery("");
      router.push(href);
      const next = [{ label, href }, ...recents.filter((r) => r.href !== href)].slice(0, 5);
      setRecents(next);
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [router, recents],
  );
  const run = (fn: () => void) => {
    setOpen(false);
    setQuery("");
    fn();
  };

  const ctx = useMemo(() => ({ open: () => setOpen(true) }), []);
  const item = "flex h-10 cursor-default select-none items-center gap-3 rounded-[10px] px-3 text-sm text-ink outline-none data-[selected=true]:bg-accent data-[selected=true]:text-white [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-3 data-[selected=true]:[&_svg]:text-white/90";
  const heading = "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-ink-3";

  return (
    <Ctx.Provider value={ctx}>
      {children}
      <RD.Root open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQuery(""); }}>
        <AnimatePresence>
          {open && (
            <RD.Portal forceMount>
              <RD.Overlay asChild forceMount>
                <motion.div className="fixed inset-0 z-[90] bg-[var(--scrim)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: duration.control }} />
              </RD.Overlay>
              <RD.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  initial={{ opacity: 0, scale: 0.97, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, transition: { duration: duration.micro } }}
                  transition={spring.popover}
                  className="material fixed left-1/2 top-[12vh] z-[91] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[18px] outline-none"
                >
                  <RD.Title className="sr-only">Command palette</RD.Title>
                  <Command label="Command palette" shouldFilter={false} loop className="flex max-h-[min(560px,70vh)] flex-col">
                    <div className="flex items-center gap-3 px-4 hairline-b">
                      <Search className="size-[18px] shrink-0 text-ink-3" />
                      <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Search products, brands, comparisons, or type a command…" className="h-14 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-ink-4" />
                      {isFetching && <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-label="Searching" />}
                      <Kbd>esc</Kbd>
                    </div>
                    <Command.List className={cn("overflow-y-auto p-2", heading)}>
                      <Command.Empty className="px-4 py-10 text-center text-sm text-ink-3">No matches. Try an ASIN, brand or product name — or paste an Amazon link to add it.</Command.Empty>
                      {/https?:\/\/|amzn|amazon\.|^B0[A-Z0-9]{8}$/i.test(query.trim()) && (
                        <Command.Group heading="Add">
                          <Command.Item value="add-pasted" className={item} onSelect={() => run(() => importer.open(query.trim()))}>
                            <Plus /> Import “{query.trim().slice(0, 48)}”
                          </Command.Item>
                        </Command.Group>
                      )}
                      {!query && recents.length > 0 && (
                        <Command.Group heading="Recent">
                          {recents.map((r) => (
                            <Command.Item key={r.href} value={`recent-${r.href}`} className={item} onSelect={() => go(r.href, r.label)}>
                              <Search /> {r.label}
                            </Command.Item>
                          ))}
                        </Command.Group>
                      )}
                      {data?.products.length ? (
                        <Command.Group heading="Products">
                          {data.products.map((p) => (
                            <Command.Item key={p.id} value={`product-${p.id}`} className={cn(item, "h-12")} onSelect={() => go(`/products/${p.id}`, p.title)}>
                              <ProductImage src={p.imageUrl} alt="" size={30} rounded={7} />
                              <span className="min-w-0 flex-1 truncate">
                                <span className="font-medium">{p.brand ? `${p.brand} · ` : ""}</span>
                                {p.title}
                              </span>
                              <span className="flex items-center gap-2 text-xs opacity-70">
                                {p.variants} var.
                                <MarketplaceTag code={p.marketplace} className="text-inherit" />
                              </span>
                            </Command.Item>
                          ))}
                        </Command.Group>
                      ) : null}
                      {data?.groups.length ? (
                        <Command.Group heading="Comparisons">
                          {data.groups.map((g) => (
                            <Command.Item key={g.id} value={`group-${g.id}`} className={item} onSelect={() => go(`/comparisons/${g.id}`, g.name)}>
                              <BarChart3 /> <span className="flex-1">{g.name}</span> <span className="text-xs opacity-70">{g.items} listings</span>
                            </Command.Item>
                          ))}
                        </Command.Group>
                      ) : null}
                      {data?.brands.length ? (
                        <Command.Group heading="Brands">
                          {data.brands.map((b) => (
                            <Command.Item key={b} value={`brand-${b}`} className={item} onSelect={() => go(`/brands?brand=${encodeURIComponent(b)}`, b)}>
                              <Tag /> {b}
                            </Command.Item>
                          ))}
                        </Command.Group>
                      ) : null}
                      <Command.Group heading="Actions">
                        {[
                          { id: "add", label: "Add product", icon: <Plus />, k: "N", fn: () => importer.open() },
                          { id: "compare", label: "New comparison", icon: <BarChart3 />, fn: () => router.push("/comparisons?new=1") },
                          { id: "alert", label: "New alert", icon: <Bell />, fn: () => router.push("/alerts?new=1") },
                          {
                            id: "refresh",
                            label: "Refresh all tracked products",
                            icon: <RefreshCw />,
                            fn: async () => {
                              const { rows } = await api<{ rows: { variantId: string; tracked: boolean }[] }>("/api/variants");
                              const ids = rows.filter((r) => r.tracked).map((r) => r.variantId);
                              if (!ids.length) return toast("Nothing to refresh yet.");
                              const r = await api<{ listings: number }>("/api/refresh", { method: "POST", body: { variantIds: ids } });
                              toast.success(`Refresh queued for ${r.listings} listing${r.listings === 1 ? "" : "s"}`);
                            },
                          },
                          { id: "theme", label: resolvedTheme === "dark" ? "Switch to light appearance" : "Switch to dark appearance", icon: resolvedTheme === "dark" ? <Sun /> : <Moon />, fn: () => setTheme(resolvedTheme === "dark" ? "light" : "dark") },
                        ]
                          .filter((a) => !query || a.label.toLowerCase().includes(query.toLowerCase()))
                          .map((a) => (
                            <Command.Item key={a.id} value={`action-${a.id}`} className={item} onSelect={() => run(a.fn)}>
                              {a.icon} <span className="flex-1">{a.label}</span> {a.k && <Kbd className="opacity-70">{a.k}</Kbd>}
                            </Command.Item>
                          ))}
                      </Command.Group>
                      <Command.Group heading="Go to">
                        {NAV.filter((n) => !query || n.label.toLowerCase().includes(query.toLowerCase())).map((n) => (
                          <Command.Item key={n.href} value={`nav-${n.href}`} className={item} onSelect={() => go(n.href, n.label)}>
                            <n.icon /> <span className="flex-1">{n.label}</span>
                            <span className="text-2xs uppercase tracking-wider opacity-60">{n.key}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    </Command.List>
                    <div className="flex items-center gap-4 px-4 py-2.5 text-2xs text-ink-3 hairline-t">
                      <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
                      <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
                      <span className="ml-auto flex items-center gap-1"><Package className="size-3" /> Paste an Amazon link to import</span>
                    </div>
                  </Command>
                </motion.div>
              </RD.Content>
            </RD.Portal>
          )}
        </AnimatePresence>
      </RD.Root>
    </Ctx.Provider>
  );
}
