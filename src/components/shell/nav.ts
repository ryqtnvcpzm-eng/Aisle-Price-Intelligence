import { Activity, BarChart3, Bell, FileText, Home, LineChart, Newspaper, Package, Settings, Sparkles, Tag } from "lucide-react";

export const NAV = [
  { href: "/", label: "Overview", icon: Home, key: "g o" },
  { href: "/briefing", label: "Monday Briefing", icon: Newspaper, key: "g w" },
  { href: "/products", label: "Products", icon: Package, key: "g p" },
  { href: "/comparisons", label: "Comparisons", icon: BarChart3, key: "g c" },
  { href: "/brands", label: "Brands", icon: Tag, key: "g b" },
  { href: "/history", label: "Price History", icon: LineChart, key: "g h" },
  { href: "/insights", label: "Insights", icon: Sparkles, key: "g i" },
  { href: "/alerts", label: "Alerts", icon: Bell, key: "g a" },
  { href: "/reports", label: "Reports", icon: FileText, key: "g r" },
  { href: "/activity", label: "Activity", icon: Activity, key: "g y" },
  { href: "/settings", label: "Settings", icon: Settings, key: "g s" },
] as const;

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
