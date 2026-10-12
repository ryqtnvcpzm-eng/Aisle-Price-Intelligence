"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { ArrowRight, BarChart3, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { spring } from "../motion/tokens";
import { AnimatedNumber } from "../ui/animated-number";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { ProductImage } from "../ui/product-image";
import { Select } from "../ui/select";

export interface TrayItem {
  variantId: string;
  label: string;
  brandName: string | null;
  imageUrl: string | null;
  marketplace: string;
}

interface TrayCtx {
  items: TrayItem[];
  has: (id: string) => boolean;
  toggle: (item: TrayItem) => void;
  add: (items: TrayItem[]) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const Ctx = createContext<TrayCtx | null>(null);
export function useCompareTray() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCompareTray outside provider");
  return v;
}

/**
 * The comparison builder. Selected variants collect in a floating tray that
 * grows as items arrive; "Compare" turns them into a named comparison group.
 * Selection persists across pages so users can gather items from anywhere.
 */
export function CompareTrayProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<TrayItem[]>([]);
  const has = useCallback((id: string) => items.some((i) => i.variantId === id), [items]);
  const toggle = useCallback((item: TrayItem) => setItems((xs) => (xs.some((x) => x.variantId === item.variantId) ? xs.filter((x) => x.variantId !== item.variantId) : [...xs, item])), []);
  const add = useCallback((more: TrayItem[]) => setItems((xs) => [...xs, ...more.filter((m) => !xs.some((x) => x.variantId === m.variantId))]), []);
  const remove = useCallback((id: string) => setItems((xs) => xs.filter((x) => x.variantId !== id)), []);
  const clear = useCallback(() => setItems([]), []);
  const value = useMemo(() => ({ items, has, toggle, add, remove, clear }), [items, has, toggle, add, remove, clear]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Tray />
    </Ctx.Provider>
  );
}

function Tray() {
  const { items, remove, clear } = useCompareTray();
  const [creating, setCreating] = useState(false);
  const shown = items.slice(0, 6);
  const extra = items.length - shown.length;
  const mixedMarkets = new Set(items.map((i) => i.marketplace)).size > 1;

  return (
    <>
      <AnimatePresence>
        {items.length > 0 && (
          <motion.div
            key="tray"
            role="region"
            aria-label="Comparison tray"
            initial={{ y: 90, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 90, opacity: 0, scale: 0.96 }}
            transition={spring.panel}
            className="material fixed bottom-[calc(76px+env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 rounded-[18px] p-2 md:bottom-6"
          >
            <motion.div layout transition={spring.layout} className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 pl-1.5 pr-1">
                <BarChart3 className="size-4 text-accent" />
                <span className="text-sm font-medium">
                  <AnimatedNumber value={items.length} format={(n) => String(Math.round(n))} emphasize={false} /> <span className="hidden sm:inline">to compare</span>
                </span>
              </div>
              <LayoutGroup>
                <ul className="flex items-center -space-x-1.5">
                  <AnimatePresence initial={false} mode="popLayout">
                    {shown.map((i) => (
                      <motion.li
                        key={i.variantId}
                        layout
                        initial={{ scale: 0.4, opacity: 0, y: 12 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.4, opacity: 0 }}
                        transition={spring.popover}
                        className="group relative"
                      >
                        <div className="rounded-[10px] ring-2 ring-[var(--glass-strong)]">
                          <ProductImage src={i.imageUrl} alt={`${i.brandName ?? ""} ${i.label}`} size={34} rounded={9} />
                        </div>
                        <button onClick={() => remove(i.variantId)} aria-label={`Remove ${i.brandName ?? ""} ${i.label}`} className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full bg-ink text-ink-inverse group-hover:flex focus-visible:flex">
                          <X className="size-2.5" strokeWidth={3} />
                        </button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </LayoutGroup>
              {extra > 0 && <span className="num pl-2 text-xs text-ink-3">+{extra}</span>}
              <div className="ml-1 flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={clear} aria-label="Clear selection">
                  Clear
                </Button>
                <Button variant="primary" size="sm" disabled={items.length < 2} onClick={() => setCreating(true)} title={items.length < 2 ? "Select at least two listings" : mixedMarkets ? "Listings span marketplaces — prices won't be mixed across currencies" : undefined}>
                  Compare <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <CreateComparisonDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

const BASES = [
  { value: "auto", label: "Automatic", hint: "best shared unit" },
  { value: "per_100g", label: "Per 100 g" },
  { value: "per_kg", label: "Per kg" },
  { value: "per_100ml", label: "Per 100 ml" },
  { value: "per_l", label: "Per litre" },
  { value: "per_unit", label: "Per tablet / capsule / item" },
  { value: "per_serving", label: "Per serving" },
  { value: "per_pack", label: "Per pack (no normalization)" },
];

export function CreateComparisonDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { items, clear } = useCompareTray();
  const router = useRouter();
  const [name, setName] = useState("");
  const [basis, setBasis] = useState("auto");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const r = await api<{ group: { id: string } }>("/api/groups", { method: "POST", body: { name: name.trim(), basis: basis === "auto" ? undefined : basis, variantIds: items.map((i) => i.variantId) } });
      onOpenChange(false);
      clear();
      setName("");
      router.push(`/comparisons/${r.group.id}?created=1`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't create the comparison.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New comparison" description={`${items.length} listings will be ranked on a normalized basis.`} size="sm" initialFocus="#cmp-name">
      <div className="space-y-4 px-6 py-5">
        <Field label="Name" htmlFor="cmp-name">
          <Input id="cmp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Whey Protein — 1 kg" onKeyDown={(e) => e.key === "Enter" && name.trim() && create()} />
        </Field>
        <Field label="Compare prices" hint="Items whose quantity can't be expressed in this unit are shown but left out of rankings.">
          <Select ariaLabel="Normalization basis" className="w-full" value={basis} onValueChange={setBasis} options={BASES} />
        </Field>
        <ul className="flex flex-wrap gap-1.5">
          {items.map((i) => (
            <li key={i.variantId} className="flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2.5 text-xs shadow-[var(--ring-inset)]">
              <ProductImage src={i.imageUrl} alt="" size={20} rounded={10} />
              {i.brandName} {i.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex justify-end gap-2 px-6 py-4 hairline-t">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={create}>
          Create comparison
        </Button>
      </div>
    </Dialog>
  );
}
