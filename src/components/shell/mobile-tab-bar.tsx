"use client";

import { AnimatePresence, motion } from "motion/react";
import { BarChart3, Bell, Home, MoreHorizontal, Package, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { spring } from "../motion/tokens";
import { useImport } from "../import/import-context";
import { isActive, NAV } from "./nav";

const TABS = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/products", label: "Products", icon: Package },
  { href: "/comparisons", label: "Compare", icon: BarChart3 },
  { href: "/alerts", label: "Alerts", icon: Bell },
];

/** iOS-style bottom tab bar with a center add action and a "More" sheet. */
export function MobileTabBar() {
  const pathname = usePathname();
  const importer = useImport();
  const [more, setMore] = useState(false);
  const moreActive = !TABS.some((t) => isActive(pathname, t.href));

  return (
    <>
      <nav className="material-strong fixed inset-x-0 bottom-0 z-40 bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] pb-[env(safe-area-inset-bottom)] shadow-[inset_0_0.5px_0_var(--line)] md:hidden" aria-label="Primary">
        <ul className="mx-auto flex h-[58px] max-w-[520px] items-stretch justify-around px-2">
          {TABS.slice(0, 2).map((t) => (
            <Tab key={t.href} {...t} active={isActive(pathname, t.href)} />
          ))}
          <li className="flex items-center">
            <motion.button whileTap={{ scale: 0.92 }} transition={spring.press} onClick={() => importer.open()} aria-label="Add product" className="flex size-11 items-center justify-center rounded-full bg-accent text-white shadow-[0_4px_12px_-2px_var(--accent-soft)]">
              <Plus className="size-5" strokeWidth={2.5} />
            </motion.button>
          </li>
          {TABS.slice(2).map((t) => (
            <Tab key={t.href} {...t} active={isActive(pathname, t.href)} />
          ))}
          <li className="flex">
            <button onClick={() => setMore(true)} className={cn("flex w-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium", moreActive ? "text-accent" : "text-ink-3")} aria-label="More sections">
              <MoreHorizontal className="size-[22px]" strokeWidth={1.9} />
              More
            </button>
          </li>
        </ul>
      </nav>
      <AnimatePresence>
        {more && (
          <>
            <motion.div className="fixed inset-0 z-50 bg-[var(--scrim)] md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMore(false)} />
            <motion.div
              role="dialog"
              aria-label="More sections"
              className="fixed inset-x-2 bottom-2 z-50 rounded-[22px] bg-surface p-2 pb-[calc(8px+env(safe-area-inset-bottom))] shadow-[var(--shadow-pop)] md:hidden"
              initial={{ y: "110%" }}
              animate={{ y: 0 }}
              exit={{ y: "110%" }}
              transition={spring.panel}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => info.offset.y > 80 && setMore(false)}
            >
              <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-[var(--line-strong)]" />
              <div className="grid grid-cols-3 gap-1">
                {NAV.filter((n) => !TABS.some((t) => t.href === n.href)).map((n) => (
                  <Link key={n.href} href={n.href} onClick={() => setMore(false)} className={cn("flex flex-col items-center gap-1.5 rounded-[14px] px-2 py-3.5 text-xs font-medium", isActive(pathname, n.href) ? "bg-accent-soft text-accent" : "text-ink-2 active:bg-[var(--hairline)]")}>
                    <n.icon className="size-5" strokeWidth={1.9} />
                    {n.label}
                  </Link>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function Tab({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof Home; active: boolean }) {
  return (
    <li className="flex">
      <Link href={href} aria-current={active ? "page" : undefined} className={cn("relative flex w-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors", active ? "text-accent" : "text-ink-3")}>
        <motion.span animate={{ scale: active ? 1.06 : 1 }} transition={spring.snappy}>
          <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.9} />
        </motion.span>
        {label}
      </Link>
    </li>
  );
}
