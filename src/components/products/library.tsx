"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Archive, BarChart3, Bookmark, Check, Download, FileUp, Filter, LayoutGrid, Package, Plus, RefreshCw, Rows3, Search, Star, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { MARKETPLACES, isMarketplaceCode } from "@/lib/marketplaces";
import type { FamilySummary, VariantRow } from "@/server/catalog/queries";
import { useCompareTray } from "../comparisons/compare-tray";
import { useImport } from "../import/import-context";
import { spring } from "../motion/tokens";
import { usePrefs } from "../shell/preferences";
import { Kbd } from "../ui/badge";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../ui/popover";
import { Segmented } from "../ui/segmented";
import { LibraryGrid } from "./library-grid";
import { LibraryTable } from "./library-table";
import { familyStats } from "./library-utils";

type View = "grid" | "table";
type GroupBy = "none" | "brand" | "category" | "marketplace";
type StatusFilter = "all" | "unavailable" | "attention" | "favorites" | "discounted" | "paused";
const STATUS_FILTERS: StatusFilter[] = ["all", "unavailable", "attention", "favorites", "discounted", "paused"];

interface ViewState {
  view: View;
  q: string;
  groupBy: GroupBy;
  status: StatusFilter;
  brands: string[];
  sort: string;
}

const DEFAULT: ViewState = { view: "grid", q: "", groupBy: "none", status: "all", brands: [], sort: "brand" };
const LS_KEY = "aisle-library-view";

interface SavedView {
  id: string;
  name: string;
  state: Partial<ViewState>;
}

export function Library({ families, savedViews: initialViews }: { families: FamilySummary[]; savedViews: SavedView[] }) {
  const importer = useImport();
  const router = useRouter();
  const params = useSearchParams();
  const tray = useCompareTray();
  const { marketplace } = usePrefs();
  const [state, setState] = useState<ViewState>(DEFAULT);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // family ids (grid) or variant ids (table)
  const [savedViews, setSavedViews] = useState(initialViews);
  const [busy, setBusy] = useState<string | null>(null);
  const highlight = useMemo(() => new Set((params.get("new") ?? "").split(",").filter(Boolean)), [params]);

  // Persist the working view per browser so returning feels continuous.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      // A deep link (?status=paused) wins over the remembered view.
      const linked = params.get("status") as StatusFilter | null;
      // Storage is client-only; restoring after mount keeps hydration identical to the server render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved || linked) setState((s) => ({ ...s, ...(saved ? JSON.parse(saved) : {}), q: "", ...(linked && STATUS_FILTERS.includes(linked) ? { status: linked } : {}) }));
    } catch {
      /* ignore */
    }
    // Restore once on mount; later URL changes are handled by navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ ...state, q: "" }));
    } catch {
      /* ignore */
    }
  }, [state]);
  const set = <K extends keyof ViewState>(k: K, v: ViewState[K]) => {
    setState((s) => ({ ...s, [k]: v }));
    setSelected(new Set());
  };

  const allBrands = useMemo(() => [...new Set(families.map((f) => f.brandName ?? "Unbranded"))].sort(), [families]);

  const filtered = useMemo(() => {
    const q = state.q.trim().toLowerCase();
    return families.filter((f) => {
      if (marketplace && f.marketplace !== marketplace) return false;
      if (state.brands.length && !state.brands.includes(f.brandName ?? "Unbranded")) return false;
      if (q && !`${f.title} ${f.brandName ?? ""} ${f.categoryName ?? ""} ${f.variants.map((v) => `${v.asin} ${v.label}`).join(" ")} ${f.tags.join(" ")}`.toLowerCase().includes(q)) return false;
      if (state.status === "favorites" && !f.favorite) return false;
      if (state.status === "unavailable" && !f.variants.some((v) => v.availability === "out_of_stock")) return false;
      if (state.status === "attention" && !f.variants.some((v) => v.freshness === "failed" || v.freshness === "provider_stale" || !v.quantities.length || v.availability === "out_of_stock")) return false;
      if (state.status === "paused" && !f.variants.some((v) => v.freshness === "paused")) return false;
      if (state.status === "discounted" && !f.variants.some((v) => v.listPriceMinor && v.priceMinor && v.priceMinor < v.listPriceMinor)) return false;
      return true;
    });
  }, [families, state, marketplace]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const stats = new Map(arr.map((f) => [f.familyId, familyStats(f)]));
    arr.sort((a, b) => {
      switch (state.sort) {
        case "change":
          return (stats.get(a.familyId)!.change7d ?? 0) - (stats.get(b.familyId)!.change7d ?? 0);
        case "price":
          return (stats.get(a.familyId)!.min ?? Infinity) - (stats.get(b.familyId)!.min ?? Infinity);
        case "title":
          return a.title.localeCompare(b.title);
        default:
          return Number(b.isReferenceBrand) - Number(a.isReferenceBrand) || (a.brandName ?? "").localeCompare(b.brandName ?? "") || a.title.localeCompare(b.title);
      }
    });
    return arr;
  }, [filtered, state.sort]);

  const groups = useMemo(() => {
    if (state.groupBy === "none") return [{ key: "all", label: null as string | null, items: sorted }];
    const m = new Map<string, FamilySummary[]>();
    for (const f of sorted) {
      const k = state.groupBy === "brand" ? (f.brandName ?? "Unbranded") : state.groupBy === "category" ? (f.categoryName ?? "Uncategorized") : f.marketplace;
      m.set(k, [...(m.get(k) ?? []), f]);
    }
    return [...m.entries()].map(([k, items]) => ({ key: k, label: state.groupBy === "marketplace" && isMarketplaceCode(k) ? `${MARKETPLACES[k].flag} ${MARKETPLACES[k].name}` : k, items }));
  }, [sorted, state.groupBy]);

  const selectedFamilies = state.view === "grid" ? families.filter((f) => selected.has(f.familyId)) : families.filter((f) => f.variants.some((v) => selected.has(v.variantId)));
  const selectedVariants: VariantRow[] = state.view === "grid" ? selectedFamilies.flatMap((f) => f.variants.filter((v) => v.tracked)) : families.flatMap((f) => f.variants).filter((v) => selected.has(v.variantId));

  const toggle = useCallback((id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  }), []);

  async function bulk(kind: "refresh" | "archive" | "favorite" | "compare") {
    if (kind === "compare") {
      tray.add(selectedVariants.map((v) => ({ variantId: v.variantId, label: v.label, brandName: v.brandName, imageUrl: v.imageUrl, marketplace: v.marketplace })));
      setSelected(new Set());
      return;
    }
    setBusy(kind);
    try {
      if (kind === "refresh") {
        const r = await api<{ listings: number; jobIds: string[] }>("/api/refresh", { method: "POST", body: { variantIds: selectedVariants.map((v) => v.variantId) } });
        toast.success(`Refresh queued for ${r.listings} listing${r.listings === 1 ? "" : "s"}`, { description: "New prices appear as soon as the provider responds." });
        setTimeout(() => router.refresh(), 2500);
      } else if (kind === "archive") {
        const ids = selectedFamilies.map((f) => f.familyId);
        await api("/api/families", { method: "PATCH", body: { ids, patch: { archived: true } } });
        router.refresh();
        toast(`Archived ${ids.length} product${ids.length === 1 ? "" : "s"}`, {
          description: "Monitoring paused. History is kept.",
          action: {
            label: "Undo",
            onClick: async () => {
              await api("/api/families", { method: "PATCH", body: { ids, patch: { archived: false } } });
              router.refresh();
            },
          },
        });
      } else if (kind === "favorite") {
        const ids = selectedFamilies.map((f) => f.familyId);
        const fav = !selectedFamilies.every((f) => f.favorite);
        await api("/api/families", { method: "PATCH", body: { ids, patch: { favorite: fav } } });
        router.refresh();
      }
      setSelected(new Set());
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function saveView() {
    const name = window.prompt("Name this view", state.status !== "all" ? `${state.status} products` : "My view");
    if (!name) return;
    const r = await api<{ view: SavedView }>("/api/views", { method: "POST", body: { scope: "products", name, state: { ...state } } });
    setSavedViews((v) => [r.view, ...v]);
    toast.success(`Saved view “${name}”`);
  }

  async function exportCsv() {
    const res = await fetch("/api/reports/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "portfolio_overview", format: "csv", marketplace: marketplace ?? undefined }) });
    if (!res.ok) return toast.error("Export failed.");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "aisle-products.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!families.length) {
    return (
      <EmptyState
        icon={<Package />}
        title="No products yet"
        description="Paste an Amazon link — or a whole list — and Aisle finds every variant, then keeps their prices current."
        action={
          <div className="flex gap-2">
            <Button variant="primary" size="lg" onClick={() => importer.open()}>
              <Plus className="size-4" /> Add product
            </Button>
          </div>
        }
      />
    );
  }

  const totalVariants = filtered.reduce((s, f) => s + f.variants.length, 0);

  return (
    <div className="space-y-5">
      {/* Controls: one row above the content they scope */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[280px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input
            value={state.q}
            onChange={(e) => setState((s) => ({ ...s, q: e.target.value }))}
            placeholder="Filter by name, ASIN, tag…"
            aria-label="Filter products"
            className="h-8 w-full rounded-[9px] bg-surface pl-8 pr-8 text-sm shadow-[var(--shadow-xs),inset_0_0_0_0.5px_var(--line-strong)] outline-none placeholder:text-ink-4 focus:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-soft)]"
          />
          {state.q && (
            <button onClick={() => setState((s) => ({ ...s, q: "" }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3" aria-label="Clear filter">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Segmented<StatusFilter>
          ariaLabel="Status filter"
          size="sm"
          value={state.status}
          onChange={(v) => set("status", v)}
          // Scrolls on narrow screens; the edge fade says there is more.
          className="max-w-full overflow-x-auto no-scrollbar [mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)] sm:[mask-image:none]"
          options={[
            { value: "all", label: "All" },
            { value: "favorites", label: <><Star className="size-3" /> Favorites</> },
            { value: "discounted", label: "Discounted" },
            { value: "unavailable", label: "Unavailable" },
            { value: "attention", label: "Needs attention" },
            { value: "paused", label: "Paused" },
          ]}
        />
        <Menu
          align="start"
          trigger={
            <Button variant="ghost" size="sm" className={cn(state.brands.length && "text-accent")}>
              <Filter className="size-3.5" /> {state.brands.length ? `${state.brands.length} brand${state.brands.length === 1 ? "" : "s"}` : "Brand"}
            </Button>
          }
        >
          <MenuLabel>Brands</MenuLabel>
          {allBrands.map((b) => (
            <MenuItem key={b} icon={state.brands.includes(b) ? <Check /> : <span />} onSelect={() => set("brands", state.brands.includes(b) ? state.brands.filter((x) => x !== b) : [...state.brands, b])}>
              {b}
            </MenuItem>
          ))}
          {state.brands.length > 0 && (
            <>
              <MenuSeparator />
              <MenuItem onSelect={() => set("brands", [])}>Clear brand filter</MenuItem>
            </>
          )}
        </Menu>
        <Menu
          align="start"
          trigger={
            <Button variant="ghost" size="sm">
              <Rows3 className="size-3.5" /> {state.groupBy === "none" ? "Group" : `By ${state.groupBy}`}
            </Button>
          }
        >
          <MenuLabel>Group by</MenuLabel>
          {(["none", "brand", "category", "marketplace"] as GroupBy[]).map((g) => (
            <MenuItem key={g} icon={state.groupBy === g ? <Check /> : <span />} onSelect={() => set("groupBy", g)}>
              {g === "none" ? "No grouping" : g[0]!.toUpperCase() + g.slice(1)}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuLabel>Sort</MenuLabel>
          {[
            ["brand", "Reference brand first"],
            ["title", "Name"],
            ["price", "Lowest price"],
            ["change", "Biggest 7-day drop"],
          ].map(([k, l]) => (
            <MenuItem key={k} icon={state.sort === k ? <Check /> : <span />} onSelect={() => set("sort", k!)}>
              {l}
            </MenuItem>
          ))}
        </Menu>
        <Menu
          align="start"
          trigger={
            <Button variant="ghost" size="sm">
              <Bookmark className="size-3.5" /> Views
            </Button>
          }
        >
          <MenuLabel>Saved views</MenuLabel>
          {savedViews.length === 0 && <div className="px-2 py-1.5 text-xs text-ink-3">No saved views yet</div>}
          {savedViews.map((v) => (
            <MenuItem key={v.id} onSelect={() => setState({ ...DEFAULT, ...v.state })}>
              {v.name}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon={<Plus />} onSelect={saveView}>
            Save current view…
          </MenuItem>
          {savedViews.length > 0 && (
            <MenuItem
              icon={<Trash2 />}
              destructive
              onSelect={async () => {
                const last = savedViews[0]!;
                await api(`/api/views?id=${last.id}`, { method: "DELETE" });
                setSavedViews((x) => x.slice(1));
                toast(`Deleted view “${last.name}”`);
              }}
            >
              Delete most recent view
            </MenuItem>
          )}
        </Menu>
        <div className="ml-auto flex items-center gap-1.5">
          <Menu align="end" trigger={<Button variant="ghost" size="icon-sm" aria-label="Import or export"><Download className="size-4" /></Button>}>
            <MenuItem icon={<FileUp />} onSelect={() => importer.open()}>Import Amazon links (CSV)…</MenuItem>
            <MenuItem icon={<Download />} onSelect={exportCsv}>Export products as CSV</MenuItem>
          </Menu>
          <Segmented<View>
            ariaLabel="Layout"
            size="sm"
            value={state.view}
            onChange={(v) => set("view", v)}
            options={[
              { value: "grid", label: <LayoutGrid className="size-3.5" />, title: "Grid" },
              { value: "table", label: <Rows3 className="size-3.5" />, title: "Table" },
            ]}
          />
        </div>
      </div>

      <div className="text-xs text-ink-3">
        {filtered.length} product{filtered.length === 1 ? "" : "s"} · {totalVariants} variant{totalVariants === 1 ? "" : "s"}
        {state.view === "grid" && <span className="hidden sm:inline"> · Click to open, <Kbd>⌘</Kbd>-click or the circle to select</span>}
      </div>

      {filtered.length === 0 ? (
        <EmptyState compact icon={<Search />} title="No matches" description="Nothing matches these filters. Clear them to see your whole library." action={<Button onClick={() => setState(DEFAULT)}>Reset filters</Button>} />
      ) : (
        <LayoutGroup>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={state.view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="space-y-8">
              {groups.map((g) => (
                <section key={g.key} aria-label={g.label ?? "Products"}>
                  {g.label && (
                    <h2 className="mb-3 flex items-baseline gap-2 text-sm font-semibold">
                      {g.label} <span className="num text-xs font-normal text-ink-3">{g.items.length}</span>
                    </h2>
                  )}
                  {state.view === "grid" ? <LibraryGrid families={g.items} selected={selected} onToggle={toggle} highlight={highlight} /> : <LibraryTable families={g.items} selected={selected} onSelectionChange={setSelected} />}
                </section>
              ))}
            </motion.div>
          </AnimatePresence>
        </LayoutGroup>
      )}

      {/* Floating bulk-action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={spring.panel} className="material fixed bottom-[calc(140px+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-[16px] p-1.5 md:bottom-24" role="toolbar" aria-label="Bulk actions">
            <span className="num px-2.5 text-sm font-medium">{selectedVariants.length} variant{selectedVariants.length === 1 ? "" : "s"}</span>
            <Button variant="ghost" size="sm" onClick={() => bulk("compare")}>
              <BarChart3 className="size-3.5" /> Compare
            </Button>
            <Button variant="ghost" size="sm" loading={busy === "refresh"} onClick={() => bulk("refresh")}>
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
            <Button variant="ghost" size="sm" loading={busy === "favorite"} onClick={() => bulk("favorite")}>
              <Star className="size-3.5" /> Favorite
            </Button>
            <Button variant="ghost" size="sm" loading={busy === "archive"} onClick={() => bulk("archive")}>
              <Archive className="size-3.5" /> Archive
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setSelected(new Set())} aria-label="Clear selection">
              <X className="size-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
