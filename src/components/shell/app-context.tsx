"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface AppInfo {
  user: { id: string; name: string; email: string };
  workspace: { id: string; name: string; defaultMarketplace: string; defaultBasis: string; timeZone: string; onboarded: boolean; settings: { defaultIntervalMinutes: number; digest: string; emailAlerts: boolean; significantChangePct: number; exportIncludeMethodology: boolean; brandProtection?: boolean; emailBriefing?: boolean } };
  /** The workspace's own brand ("My Brand"), or null until someone chooses it. */
  referenceBrand: { id: string; name: string } | null;
  role: string;
  dataMode: "demo" | "live";
  providerLabel: string;
  sampleLinks: { label: string; url: string }[];
  marketplaces: string[];
}

const Ctx = createContext<AppInfo | null>(null);

export function AppInfoProvider({ value, children }: { value: AppInfo; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppInfoProvider");
  return v;
}
