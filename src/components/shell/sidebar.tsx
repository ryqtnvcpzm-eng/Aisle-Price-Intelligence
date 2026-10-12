"use client";

import { LayoutGroup, motion, AnimatePresence } from "motion/react";
import { PanelLeft, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { duration, spring } from "../motion/tokens";
import { Kbd } from "../ui/badge";
import { Tooltip } from "../ui/tooltip";
import { useApp } from "./app-context";
import { useImport } from "../import/import-context";
import { isActive, NAV } from "./nav";
import { usePrefs } from "./preferences";
import { Logo } from "./logo";

export const SIDEBAR_W = 232;
export const SIDEBAR_COLLAPSED_W = 64;

/**
 * macOS-style source list. Width springs between expanded/collapsed; labels
 * fade and icons stay pinned so nothing jumps; the selection highlight glides
 * between items via a shared layoutId.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed: collapsed, setSidebarCollapsed } = usePrefs();
  const app = useApp();
  const importer = useImport();

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_W }}
      transition={spring.layout}
      className="material-strong sticky top-0 z-30 hidden h-dvh shrink-0 flex-col overflow-hidden bg-[var(--sidebar)] shadow-[inset_-0.5px_0_0_var(--line)] md:flex"
      aria-label="Primary"
    >
      <div className="flex h-14 items-center gap-2 px-[18px]">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none" aria-label="Aisle home">
          <Logo size={28} />
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.div key="wordmark" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -4 }} transition={{ duration: duration.micro }} className="min-w-0">
                <div className="text-[15px] font-semibold leading-tight tracking-tight">Aisle</div>
                <div className="truncate text-2xs leading-tight text-ink-3">{app.workspace.name}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </Link>
      </div>

      <div className="px-3 pb-2">
        <Tooltip content={collapsed ? "Add product (N)" : null} side="right">
          <motion.button
            whileTap={{ scale: 0.97 }}
            transition={spring.press}
            onClick={() => importer.open()}
            className={cn("flex h-8 w-full items-center gap-2 rounded-[9px] bg-accent px-2 text-sm font-medium text-white shadow-[0_1px_1px_rgba(0,0,0,0.08),inset_0_0.5px_0_rgba(255,255,255,0.25)] transition-colors hover:bg-accent-hover", collapsed && "justify-center px-0")}
          >
            <Plus className="size-4 shrink-0" strokeWidth={2.4} />
            {!collapsed && <span className="flex-1 text-left">Add product</span>}
            {!collapsed && <Kbd className="text-white/70 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.35)]">N</Kbd>}
          </motion.button>
        </Tooltip>
      </div>

      <nav className="no-scrollbar flex-1 overflow-y-auto px-3 py-1">
        <LayoutGroup id="sidebar">
          <ul className="space-y-[2px]">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Tooltip content={collapsed ? item.label : null} side="right">
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn("relative flex h-8 items-center gap-2.5 rounded-[8px] px-2 text-sm outline-none transition-colors duration-150", active ? "font-medium text-ink" : "text-ink-2 hover:bg-[var(--hairline)] hover:text-ink")}
                    >
                      {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-[8px] bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] dark:bg-[color-mix(in_srgb,var(--ink)_11%,transparent)]" transition={spring.snappy} />}
                      <Icon className={cn("relative z-10 size-[17px] shrink-0", active ? "text-accent" : "text-ink-3")} strokeWidth={active ? 2.2 : 1.9} />
                      <motion.span initial={false} animate={{ opacity: collapsed ? 0 : 1 }} transition={{ duration: duration.micro }} className="relative z-10 truncate">
                        {item.label}
                      </motion.span>
                    </Link>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        </LayoutGroup>
      </nav>

      <div className="space-y-2 px-3 pb-3 pt-2">
        <AnimatePresence initial={false}>
          {!collapsed && app.dataMode === "demo" && (
            <motion.div key="demo" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={spring.layout} className="overflow-hidden">
              <Link href="/settings#providers" className="block rounded-[10px] bg-sim-soft px-3 py-2.5 text-xs leading-snug text-ink-2 outline-none transition-opacity hover:opacity-90">
                <span className="font-semibold text-sim">Demo mode.</span> Prices are simulated from a fictional catalog. Connect Keepa for live data.
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
        <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
          <button
            onClick={() => setSidebarCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2 text-sm text-ink-3 outline-none transition-colors hover:bg-[var(--hairline)] hover:text-ink"
          >
            <PanelLeft className="size-[17px] shrink-0" strokeWidth={1.9} />
            <motion.span initial={false} animate={{ opacity: collapsed ? 0 : 1 }} transition={{ duration: duration.micro }} className="truncate">
              Collapse
            </motion.span>
          </button>
        </Tooltip>
      </div>
    </motion.aside>
  );
}
