"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Bell, Check, ChevronDown, CircleUser, FlaskConical, LogOut, Monitor, Moon, Plus, Search, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/freshness";
import { MARKETPLACES, isMarketplaceCode } from "@/lib/marketplaces";
import { spring, staggerDelay } from "../motion/tokens";
import { Badge, Kbd } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Popover } from "../ui/popover";
import { Segmented } from "../ui/segmented";
import { useImport } from "../import/import-context";
import { useApp } from "./app-context";
import { usePalette } from "./command-palette";
import { usePrefs, type ThemePref } from "./preferences";
import { authClient } from "@/lib/auth-client";

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
  isSimulated: boolean;
  kind: string;
}

interface Status {
  mode: "demo" | "live";
  worker: { at: string } | null;
  budget: { monitoredListings: number; tokensLeft: number | null; failures24h: number; requests24h: number };
  jobs: { status: string; createdAt: string; observations: number }[];
}

export function Toolbar({ title }: { title?: string }) {
  const app = useApp();
  const importer = useImport();
  const palette = usePalette();
  const { marketplace, setMarketplace } = usePrefs();
  const router = useRouter();

  return (
    <header className="material-strong sticky top-0 z-20 flex h-14 items-center gap-2 bg-[color-mix(in_srgb,var(--bg)_80%,transparent)] px-4 shadow-[inset_0_-0.5px_0_var(--line)] md:px-6">
      {title && <div className="mr-2 truncate text-md font-semibold tracking-tight md:hidden">{title}</div>}
      <button
        onClick={() => palette.open()}
        className="group hidden h-8 w-full max-w-[380px] items-center gap-2 rounded-[9px] bg-[var(--hairline)] px-2.5 text-sm text-ink-3 outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] focus-visible:outline-2 sm:flex dark:bg-surface-3"
        aria-label="Search products, brands and commands"
      >
        <Search className="size-4" strokeWidth={2} />
        <span className="flex-1 text-left">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <button onClick={() => palette.open()} className="flex size-8 items-center justify-center rounded-[9px] text-ink-2 hover:bg-[var(--hairline)] sm:hidden" aria-label="Search">
        <Search className="size-[18px]" />
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <Menu
          align="end"
          trigger={
            <button className="flex h-8 items-center gap-1.5 rounded-[9px] px-2 text-sm text-ink-2 outline-none transition-colors hover:bg-[var(--hairline)] hover:text-ink" aria-label="Marketplace filter">
              <span className="text-[14px] leading-none">{marketplace && isMarketplaceCode(marketplace) ? MARKETPLACES[marketplace].flag : "🌐"}</span>
              <span className="hidden lg:inline">{marketplace && isMarketplaceCode(marketplace) ? MARKETPLACES[marketplace].domain.replace("www.", "") : "All marketplaces"}</span>
              <ChevronDown className="size-3.5 text-ink-3" />
            </button>
          }
        >
          <MenuLabel>Marketplace</MenuLabel>
          <MenuItem icon={<span className="text-[13px]">🌐</span>} onSelect={() => { setMarketplace(null); router.refresh(); }} shortcut={!marketplace ? "✓" : undefined}>
            All marketplaces
          </MenuItem>
          <MenuSeparator />
          {app.marketplaces.filter(isMarketplaceCode).map((m) => (
            <MenuItem key={m} icon={<span className="text-[13px]">{MARKETPLACES[m].flag}</span>} onSelect={() => { setMarketplace(m); router.refresh(); }} shortcut={marketplace === m ? "✓" : undefined}>
              {MARKETPLACES[m].name}
            </MenuItem>
          ))}
        </Menu>
        <MonitoringIndicator />
        <Notifications />
        <Button variant="primary" size="sm" onClick={() => importer.open()} className="hidden sm:inline-flex md:hidden lg:inline-flex">
          <Plus className="size-4" strokeWidth={2.4} />
          Add product
        </Button>
        <ProfileMenu />
      </div>
    </header>
  );
}

function MonitoringIndicator() {
  const { data } = useQuery({ queryKey: ["status"], queryFn: () => api<Status>("/api/providers/status"), refetchInterval: 60_000 });
  const alive = data?.worker && Date.now() - new Date(data.worker.at).getTime() < 120_000;
  const last = data?.jobs.find((j) => j.status === "succeeded" || j.status === "partial");
  return (
    <Popover
      align="end"
      className="w-[300px] p-3"
      trigger={
        <button className="flex h-8 items-center gap-2 rounded-[9px] px-2 text-xs text-ink-2 outline-none transition-colors hover:bg-[var(--hairline)]" aria-label="Monitoring status">
          <span className="relative flex size-2">
            {alive && <span className="absolute inline-flex h-full w-full rounded-full bg-good opacity-60 motion-safe:animate-ping [animation-duration:2.4s]" />}
            <span className={cn("relative inline-flex size-2 rounded-full", alive ? "bg-good" : data ? "bg-warn" : "bg-ink-4")} />
          </span>
          <span className="hidden xl:inline">{last ? `Refreshed ${relativeTime(last.createdAt)}` : "Monitoring"}</span>
          {data?.mode === "demo" && <FlaskConical className="size-3.5 text-sim" aria-label="Demo mode" />}
        </button>
      }
    >
      <div className="space-y-3 p-1">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Monitoring</div>
          {data?.mode === "demo" ? <Badge tone="sim" size="xs">Demo data</Badge> : <Badge tone="good" size="xs">Live data</Badge>}
        </div>
        <dl className="grid grid-cols-2 gap-y-2 text-xs">
          <dt className="text-ink-3">Background worker</dt>
          <dd className={cn("text-right font-medium", alive ? "text-good" : "text-warn")}>{alive ? "Running" : "No heartbeat"}</dd>
          <dt className="text-ink-3">Monitored listings</dt>
          <dd className="num text-right">{data?.budget.monitoredListings ?? "—"}</dd>
          <dt className="text-ink-3">Last batch</dt>
          <dd className="text-right">{last ? relativeTime(last.createdAt) : "—"}</dd>
          <dt className="text-ink-3">Requests (24h)</dt>
          <dd className="num text-right">{data ? `${data.budget.requests24h} · ${data.budget.failures24h} failed` : "—"}</dd>
        </dl>
        {!alive && data && <p className="rounded-[8px] bg-warn-soft px-2.5 py-2 text-xs text-ink-2">Hourly refreshes run in the separate worker process (<code className="font-mono">pnpm worker</code>). Manual refresh still works.</p>}
        <Link href="/settings#monitoring" className="block text-xs font-medium text-accent">Monitoring settings →</Link>
      </div>
    </Popover>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ notifications: NotificationRow[]; unread: number }>("/api/notifications"), refetchInterval: 45_000 });
  const unread = data?.unread ?? 0;
  const markAll = async () => {
    await api("/api/notifications", { method: "POST", body: { ids: "all" } });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-[min(380px,calc(100vw-24px))] p-0"
      trigger={
        <button className="relative flex size-8 items-center justify-center rounded-[9px] text-ink-2 outline-none transition-colors hover:bg-[var(--hairline)] hover:text-ink" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell className="size-[18px]" strokeWidth={1.9} />
          <AnimatePresence>
            {unread > 0 && (
              <motion.span key="dot" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring.snappy} className="num absolute right-0.5 top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-bad px-1 text-[9.5px] font-semibold text-white ring-2 ring-[var(--bg)]">
                {unread > 9 ? "9+" : unread}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      }
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <div className="text-sm font-semibold">Notifications</div>
        {unread > 0 && (
          <button onClick={markAll} className="text-xs font-medium text-accent">
            Mark all read
          </button>
        )}
      </div>
      <div className="max-h-[420px] overflow-y-auto px-1.5 pb-1.5">
        {!data?.notifications.length ? (
          <div className="px-4 py-10 text-center text-sm text-ink-3">You're all caught up.</div>
        ) : (
          data.notifications.map((n, i) => (
            <motion.div key={n.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: staggerDelay(i) }}>
              <Link href={n.href ?? "/alerts"} onClick={() => setOpen(false)} className="flex gap-3 rounded-[10px] px-2.5 py-2.5 outline-none transition-colors hover:bg-[var(--hairline)] focus-visible:bg-[var(--hairline)]">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} aria-label={n.readAt ? undefined : "Unread"} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug text-ink">{n.title}</span>
                  {n.body && <span className="mt-0.5 block text-xs text-ink-2">{n.body}</span>}
                  <span className="mt-1 flex items-center gap-2 text-2xs text-ink-3">
                    {relativeTime(n.createdAt)}
                    {n.isSimulated && <Badge tone="sim" size="xs">Simulated</Badge>}
                    {n.kind === "test" && <Badge tone="neutral" size="xs">Test</Badge>}
                  </span>
                </span>
              </Link>
            </motion.div>
          ))
        )}
      </div>
      <div className="hairline-t px-4 py-2.5">
        <Link href="/alerts" onClick={() => setOpen(false)} className="text-xs font-medium text-accent">
          Alert rules & history →
        </Link>
      </div>
    </Popover>
  );
}

function ProfileMenu() {
  const app = useApp();
  const { theme, setTheme } = usePrefs();
  const router = useRouter();
  return (
    <Popover
      align="end"
      className="w-[260px] p-2"
      trigger={
        <button className="flex size-8 items-center justify-center rounded-full outline-none transition-opacity hover:opacity-85" aria-label="Account">
          <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-b from-[#9aa4b5] to-[#6b7385] text-xs font-semibold text-white">{app.user.name.slice(0, 1).toUpperCase()}</span>
        </button>
      }
    >
      <div className="px-2 pb-2 pt-1.5">
        <div className="truncate text-sm font-semibold">{app.user.name}</div>
        <div className="truncate text-xs text-ink-3">{app.user.email}</div>
      </div>
      <div className="px-2 pb-2">
        <Segmented<ThemePref>
          ariaLabel="Appearance"
          size="sm"
          className="w-full [&>button]:flex-1"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: <Sun className="size-3.5" />, title: "Light" },
            { value: "system", label: <Monitor className="size-3.5" />, title: "System" },
            { value: "dark", label: <Moon className="size-3.5" />, title: "Dark" },
          ]}
        />
      </div>
      <div className="h-px bg-[var(--line)]" />
      <Link href="/settings" className="mt-1 flex h-8 items-center gap-2.5 rounded-[8px] px-2 text-sm hover:bg-[var(--hairline)]">
        <CircleUser className="size-4 text-ink-3" /> Settings
      </Link>
      <button
        onClick={async () => {
          await authClient.signOut();
          router.push("/sign-in");
          router.refresh();
        }}
        className="flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2 text-sm hover:bg-[var(--hairline)]"
      >
        <LogOut className="size-4 text-ink-3" /> Sign out
      </button>
      <span className="sr-only">
        <Check />
      </span>
    </Popover>
  );
}
