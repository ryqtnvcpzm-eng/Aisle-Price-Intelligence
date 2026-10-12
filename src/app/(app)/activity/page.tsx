import { desc, eq } from "drizzle-orm";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { Page } from "@/components/ui/page";
import { db } from "@/server/db/client";
import { activityLogs, user } from "@/server/db/schema";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Activity" };

export default async function ActivityPage() {
  const ctx = await requireContext();
  const rows = await db
    .select({ a: activityLogs, actor: user.name })
    .from(activityLogs)
    .leftJoin(user, eq(user.id, activityLogs.actorUserId))
    .where(eq(activityLogs.workspaceId, ctx.workspace.id))
    .orderBy(desc(activityLogs.createdAt))
    .limit(400);
  return (
    <Page title="Activity" description="Every observed price movement and every change made in this workspace — an audit trail you can filter.">
      <ActivityFeed items={rows.map((r) => ({ id: r.a.id, kind: r.a.kind, message: r.a.message, createdAt: r.a.createdAt.toISOString(), actor: r.actor, isSimulated: r.a.isSimulated, entityType: r.a.entityType, entityId: r.a.entityId }))} />
    </Page>
  );
}
