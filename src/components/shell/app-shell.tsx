"use client";

import type { ReactNode } from "react";
import { CompareTrayProvider } from "../comparisons/compare-tray";
import { ImportProvider } from "../import/import-context";
import { AppInfoProvider, type AppInfo } from "./app-context";
import { CommandPaletteProvider } from "./command-palette";
import { MobileTabBar } from "./mobile-tab-bar";
import { PreferencesProvider } from "./preferences";
import { Sidebar } from "./sidebar";
import { Toolbar } from "./toolbar";

export function AppShell({ info, children, initialSidebarCollapsed, initialMarketplace }: { info: AppInfo; children: ReactNode; initialSidebarCollapsed: boolean; initialMarketplace: string | null }) {
  return (
    <AppInfoProvider value={info}>
      <PreferencesProvider initialSidebarCollapsed={initialSidebarCollapsed} initialMarketplace={initialMarketplace}>
        <ImportProvider>
          <CommandPaletteProvider>
            <CompareTrayProvider>
            <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lg">
              Skip to content
            </a>
            <div className="flex min-h-dvh">
              <Sidebar />
              <div className="flex min-w-0 flex-1 flex-col">
                <Toolbar />
                <main id="main" className="min-w-0 flex-1 pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-10">
                  {children}
                </main>
              </div>
            </div>
            <MobileTabBar />
            </CompareTrayProvider>
          </CommandPaletteProvider>
        </ImportProvider>
      </PreferencesProvider>
    </AppInfoProvider>
  );
}
