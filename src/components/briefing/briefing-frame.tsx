import { lastCompletedWeek } from "@/lib/week";
import type { Briefing } from "@/server/db/schema";
import type { AppContext } from "@/server/workspace/context";
import { Page } from "../ui/page";
import { BriefingView } from "./briefing-view";

/** Server-rendered page frame shared by /briefing (latest) and /briefing/[week] (archive). */
export function BriefingFrame({ ctx, briefing, archive }: { ctx: AppContext; briefing: Briefing | null; archive: { weekStart: string; weekEnd: string; containsSimulated: boolean }[] }) {
  return (
    <Page eyebrow="Weekly" title="Monday Briefing" description="Last week in one read: where your brand stands, what moved, who undercut you — and how much of it the data supports.">
      <BriefingView
        briefing={briefing ? { weekStart: briefing.weekStart, weekEnd: briefing.weekEnd, timeZone: briefing.timeZone, generatedAt: briefing.generatedAt.toISOString(), version: briefing.version, containsSimulated: briefing.containsSimulated, content: briefing.content } : null}
        archive={archive.map((a) => ({ weekStart: a.weekStart, weekEnd: a.weekEnd, containsSimulated: a.containsSimulated }))}
        canEdit={ctx.role !== "viewer"}
        lastWeekStart={lastCompletedWeek(ctx.workspace.timeZone).weekStart}
      />
    </Page>
  );
}
