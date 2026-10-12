"use client";

import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, CircleSlash, Package, Settings, Sparkles, User } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { spring, staggerDelay } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { EmptyState } from "../ui/empty-state";
import { Segmented } from "../ui/segmented";

interface Item {
  id: string;
  kind: string;
  message: string;
  createdAt: string;
  actor: string | null;
  isSimulated: boolean;
  entityType: string | null;
  entityId: string | null;
}

const PRICE = new Set(["price_down", "price_up", "stock_out", "stock_in", "out_of_stock", "back_in_stock"]);

export function ActivityFeed({ items }: { items: Item[] }) {
  const [filter, setFilter] = useState<"all" | "prices" | "changes">("all");
  const shown = items.filter((i) => filter === "all" || (filter === "prices" ? PRICE.has(i.kind) : !PRICE.has(i.kind)));
  const days = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of shown) {
      const d = new Date(i.createdAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
      m.set(d, [...(m.get(d) ?? []), i]);
    }
    return [...m.entries()];
  }, [shown]);
  if (!items.length) return <EmptyState icon={<Sparkles />} title="No activity yet" description="Price movements and workspace changes will appear here." />;
  return (
    <div className="space-y-6">
      <Segmented ariaLabel="Filter activity" size="sm" value={filter} onChange={setFilter} options={[{ value: "all", label: "Everything" }, { value: "prices", label: "Price & stock" }, { value: "changes", label: "Workspace changes" }]} />
      {days.map(([day, list], di) => (
        <section key={day}>
          <h2 className="sticky top-14 z-10 -mx-2 bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] px-2 py-2 text-xs font-semibold text-ink-3 backdrop-blur">{day}</h2>
          <ol className="card divide-y divide-[var(--hairline)]">
            {list.map((a, i) => (
              <motion.li key={a.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: di < 2 ? staggerDelay(i, 0.02) : 0, ...spring.gentle }}>
                <Link href={a.entityType === "family" && a.entityId ? `/products/${a.entityId}` : a.entityType === "group" && a.entityId ? `/comparisons/${a.entityId}` : "#"} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                  <Icon kind={a.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink">{a.message}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-2xs text-ink-3">
                      <span>{new Date(a.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                      <span>· {a.actor ? a.actor : "Monitoring"}</span>
                      {a.isSimulated && <Badge tone="sim" size="xs">Simulated</Badge>}
                    </div>
                  </div>
                </Link>
              </motion.li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Icon({ kind }: { kind: string }) {
  const cfg: Record<string, [typeof Package, string]> = {
    price_down: [ArrowDownRight, "bg-down-soft text-down"],
    price_up: [ArrowUpRight, "bg-up-soft text-up"],
    stock_out: [CircleSlash, "bg-bad-soft text-bad"],
    out_of_stock: [CircleSlash, "bg-bad-soft text-bad"],
    stock_in: [Package, "bg-good-soft text-good"],
    back_in_stock: [Package, "bg-good-soft text-good"],
    import: [Package, "bg-accent-soft text-accent"],
    settings: [Settings, "bg-[var(--hairline)] text-ink-3"],
  };
  const [I, cls] = cfg[kind] ?? [User, "bg-[var(--hairline)] text-ink-3"];
  return <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", cls)}><I className="size-3.5" strokeWidth={2.2} /></span>;
}
