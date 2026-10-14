import { CaptureSettings } from "@/components/settings/capture-settings";
import { Page } from "@/components/ui/page";
import { recentCaptures } from "@/server/capture/service";
import { captureTokenStatus } from "@/server/capture/tokens";
import { env } from "@/server/env";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Price capture" };

export default async function CaptureSettingsPage() {
  const ctx = await requireContext();
  const [token, captures] = await Promise.all([captureTokenStatus(ctx), recentCaptures(ctx.workspace.id, 25)]);
  return (
    <Page
      eyebrow="Settings"
      title="Price capture"
      description="Record the real price an Amazon.in product page shows you. You open the page in your own browser and click the bookmarklet; Aisle never visits Amazon itself."
    >
      <CaptureSettings
        appUrl={env.BETTER_AUTH_URL}
        canCapture={ctx.role !== "viewer"}
        token={token ? { prefix: token.prefix, createdAt: token.createdAt.toISOString(), lastUsedAt: token.lastUsedAt?.toISOString() ?? null } : null}
        captures={captures.map((c) => ({
          id: c.id,
          status: c.status,
          asin: c.asin,
          title: c.title,
          priceMinor: c.priceMinor,
          currency: c.currency,
          isDeal: c.isDeal,
          selector: c.selector,
          variantLabel: c.variantLabel,
          availabilityText: c.availabilityText,
          capturedAt: c.capturedAt.toISOString(),
          familyId: c.familyId,
          aisleVariant: c.aisleVariant,
          familyTitle: c.familyTitle,
          variantId: c.variantId,
        }))}
      />
    </Page>
  );
}
