import { aiEnabled } from "@/server/ai/explain";
import { SettingsView } from "@/components/settings/settings-view";
import { Page } from "@/components/ui/page";
import { env } from "@/server/env";
import { budgetSummary } from "@/server/monitoring/budget";
import { listRecentJobs } from "@/server/monitoring/scheduler";
import { activeProviderId, dataMode, listProviders, liveVerification } from "@/server/providers";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireContext();
  const active = activeProviderId();
  const [budget, jobs] = await Promise.all([budgetSummary(active), listRecentJobs(12)]);
  return (
    <Page title="Settings" description="Workspace defaults, monitoring, notifications and the data providers behind every number.">
      <SettingsView
        user={ctx.user}
        role={ctx.role}
        workspace={{ name: ctx.workspace.name, defaultMarketplace: ctx.workspace.defaultMarketplace, defaultCurrency: ctx.workspace.defaultCurrency, defaultBasis: ctx.workspace.defaultBasis, timeZone: ctx.workspace.timeZone, settings: ctx.workspace.settings }}
        providers={listProviders()}
        verification={await liveVerification()}
        mode={dataMode()}
        active={active}
        budget={JSON.parse(JSON.stringify(budget))}
        jobs={jobs.map((j) => ({ id: j.id, kind: j.kind, status: j.status, provider: j.provider, marketplace: j.marketplace, listings: j.listingIds.length, observations: j.observationsWritten, tokens: j.tokensUsed, createdAt: j.createdAt.toISOString(), error: j.error }))}
        integrations={{ email: Boolean(env.RESEND_API_KEY), ai: aiEnabled(), retentionDays: env.OBSERVATION_RETENTION_DAYS, shortLinks: env.ALLOW_SHORT_LINK_RESOLUTION === "true" }}
      />
    </Page>
  );
}
