import "server-only";
import { db } from "../db/client";
import { activityLogs } from "../db/schema";
import type { Tx } from "../db/client";

export interface ActivityInput {
  workspaceId: string | null;
  actorUserId?: string | null;
  kind: string;
  message: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  isSimulated?: boolean;
}

/** Append-only audit/activity record. Used for the Activity feed and as an audit trail. */
export async function logActivity(input: ActivityInput, tx?: Tx) {
  await (tx ?? db).insert(activityLogs).values({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId ?? null,
    kind: input.kind,
    message: input.message,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? {},
    isSimulated: input.isSimulated ?? false,
  });
}
