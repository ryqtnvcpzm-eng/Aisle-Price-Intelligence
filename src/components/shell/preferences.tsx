"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePref = "system" | "light" | "dark";

interface Prefs {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  resolvedTheme: "light" | "dark";
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  reducedTransparency: boolean;
  setReducedTransparency: (v: boolean) => void;
  marketplace: string | null;
  setMarketplace: (m: string | null) => void;
}

const Ctx = createContext<Prefs | null>(null);

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

/** Inline script run before paint: applies the theme so there's never a flash. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('aisle-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';if(localStorage.getItem('aisle-transparency')==='reduced')document.documentElement.dataset.transparency='reduced';}catch(e){document.documentElement.dataset.theme='light'}})();`;

export function PreferencesProvider({ children, initialSidebarCollapsed, initialMarketplace }: { children: ReactNode; initialSidebarCollapsed: boolean; initialMarketplace: string | null }) {
  const [theme, setThemeState] = useState<ThemePref>("system");
  const [resolvedTheme, setResolved] = useState<"light" | "dark">("light");
  const [sidebarCollapsed, setCollapsed] = useState(initialSidebarCollapsed);
  const [reducedTransparency, setRT] = useState(false);
  const [marketplace, setMp] = useState<string | null>(initialMarketplace);

  useEffect(() => {
    try {
      setThemeState((localStorage.getItem("aisle-theme") as ThemePref) || "system");
      setRT(localStorage.getItem("aisle-transparency") === "reduced");
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      setResolved(dark ? "dark" : "light");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  const setTheme = useCallback((t: ThemePref) => {
    setThemeState(t);
    try {
      localStorage.setItem("aisle-theme", t);
    } catch {
      /* ignore */
    }
  }, []);
  const setSidebarCollapsed = useCallback((v: boolean) => {
    setCollapsed(v);
    setCookie("aisle_sidebar", v ? "collapsed" : "expanded");
  }, []);
  const setReducedTransparency = useCallback((v: boolean) => {
    setRT(v);
    if (v) document.documentElement.dataset.transparency = "reduced";
    else delete document.documentElement.dataset.transparency;
    try {
      localStorage.setItem("aisle-transparency", v ? "reduced" : "normal");
    } catch {
      /* ignore */
    }
  }, []);
  const setMarketplace = useCallback((m: string | null) => {
    setMp(m);
    setCookie("aisle_mp", m ?? "all");
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, resolvedTheme, sidebarCollapsed, setSidebarCollapsed, reducedTransparency, setReducedTransparency, marketplace, setMarketplace }),
    [theme, setTheme, resolvedTheme, sidebarCollapsed, setSidebarCollapsed, reducedTransparency, setReducedTransparency, marketplace, setMarketplace],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePrefs outside PreferencesProvider");
  return v;
}
