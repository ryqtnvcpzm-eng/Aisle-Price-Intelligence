import { redirect } from "next/navigation";
import type { AppInfo } from "@/components/shell/app-context";
import { Onboarding } from "@/components/onboarding/onboarding";
import { DEMO_SAMPLE_LINKS } from "@/server/providers/demo/catalog";
import { dataMode, getActiveProvider } from "@/server/providers";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Welcome" };

export default async function Welcome() {
  const ctx = await requireContext();
  if (ctx.workspace.onboardedAt) redirect("/");
  const mode = dataMode();
  const info: AppInfo = {
    user: ctx.user,
    workspace: { id: ctx.workspace.id, name: ctx.workspace.name, defaultMarketplace: ctx.workspace.defaultMarketplace, defaultBasis: ctx.workspace.defaultBasis, timeZone: ctx.workspace.timeZone, onboarded: false, settings: ctx.workspace.settings },
    role: ctx.role,
    dataMode: mode,
    providerLabel: getActiveProvider().label,
    sampleLinks: mode === "demo" ? DEMO_SAMPLE_LINKS : [],
    marketplaces: [ctx.workspace.defaultMarketplace],
  };
  return <Onboarding info={info} />;
}
