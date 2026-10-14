import "server-only";
import { and, desc, eq, inArray, isNotNull, like, sql } from "drizzle-orm";
import { logActivity } from "../activity";
import { db, type Tx } from "../db/client";
import { alertEvents, alertRules, comparisonGroups, workspaces, type AlertRule } from "../db/schema";
import { HttpError } from "../errors";

/**
 * "Protect My Brand": four managed rules per managed "{Brand} vs Market"
 * comparison. Managed rules are keyed (`managed_key`), so enabling the pack
 * twice — or reconciling after every import — never duplicates them. They are
 * paused rather than deleted when their comparison goes away, which keeps
 * their event history.
 */
export const PROTECTION_TYPES = ["competitor_undercut", "price_leadership_change", "reference_out_of_stock", "rival_drop_5pct"] as const;
export type ProtectionType = (typeof PROTECTION_TYPES)[number];

export const PROTECTION_COPY: Record<ProtectionType, { label: string; description: string }> = {
  competitor_undercut: { label: "Competitor undercut", description: "A competitor's unit price drops below your best unit price." },
  price_leadership_change: { label: "Price leadership change", description: "The brand with the lowest unit price changes." },
  reference_out_of_stock: { label: "Your listing out of stock", description: "One of your listings is reported out of stock after being available. Unknown availability never counts." },
  rival_drop_5pct: { label: "Rival price drop ≥ 5%", description: "A competitor's observed price falls 5% or more between two consecutive checks." },
};

export const PROTECTION_COOLDOWN_MINUTES = 24 * 60;
const KEY_PREFIX = "protect:";
const managedKey = (groupId: string, type: ProtectionType) => `${KEY_PREFIX}${groupId}:${type}`;

type RuleState = { autoPaused?: boolean } & Record<string, unknown>;

/**
 * Make the managed rules match the active managed comparisons.
 *  - enabled: create missing rules; `resume` also un-pauses ones a person paused.
 *  - disabled: leave existing rules paused (they're created only once the pack is on).
 * Rules whose comparison is no longer active are paused and marked `autoPaused`,
 * so they come back on their own if the comparison does.
 */
export async function syncProtectionRules(tx: Tx, actor: { workspaceId: string; userId: string | null }, opts: { groups: { id: string; name: string }[]; enabled: boolean; resume: boolean }) {
  const existing = await tx.select().from(alertRules).where(and(eq(alertRules.workspaceId, actor.workspaceId), like(alertRules.managedKey, `${KEY_PREFIX}%`)));
  const active = new Set(opts.groups.map((g) => g.id));
  const [ws] = await tx.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, actor.workspaceId));
  const channels = ws?.settings.emailAlerts ? ["in_app", "email"] : ["in_app"];

  // Pause rules for comparisons that are no longer active.
  const orphaned = existing.filter((r) => !r.groupId || !active.has(r.groupId)).filter((r) => !r.paused);
  for (const r of orphaned) await tx.update(alertRules).set({ paused: true, state: { ...(r.state as RuleState), autoPaused: true } }).where(eq(alertRules.id, r.id));

  if (opts.enabled) {
    for (const g of opts.groups) {
      for (const type of PROTECTION_TYPES) {
        const key = managedKey(g.id, type);
        const found = existing.find((r) => r.managedKey === key);
        const name = `${PROTECTION_COPY[type].label} · ${g.name}`;
        if (!found) {
          await tx
            .insert(alertRules)
            .values({ workspaceId: actor.workspaceId, createdBy: actor.userId, name, type, groupId: g.id, params: type === "rival_drop_5pct" ? { pct: 5 } : {}, channels, cooldownMinutes: PROTECTION_COOLDOWN_MINUTES, managedKey: key })
            .onConflictDoNothing({ target: [alertRules.workspaceId, alertRules.managedKey], where: isNotNull(alertRules.managedKey) });
          continue;
        }
        const state = found.state as RuleState;
        const unpause = found.paused && (opts.resume || state.autoPaused);
        if (found.name !== name || unpause) {
          await tx.update(alertRules).set({ name, ...(unpause ? { paused: false, state: { ...state, autoPaused: false } } : {}) }).where(eq(alertRules.id, found.id));
        }
      }
    }
  }
  const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(alertRules).where(and(eq(alertRules.workspaceId, actor.workspaceId), like(alertRules.managedKey, `${KEY_PREFIX}%`), eq(alertRules.paused, false)));
  return n;
}

async function activeManagedGroups(tx: Tx | typeof db, workspaceId: string) {
  return tx
    .select({ id: comparisonGroups.id, name: comparisonGroups.name })
    .from(comparisonGroups)
    .where(and(eq(comparisonGroups.workspaceId, workspaceId), eq(comparisonGroups.managedBy, "reference_market"), sql`${comparisonGroups.archivedAt} is null`));
}

/** Turn the pack on: requires a reference brand; builds the managed comparisons first if needed. */
export async function enableProtection(actor: { workspaceId: string; userId: string | null }) {
  const { reconcileReferenceMarket, getReferenceBrand } = await import("../brand/reference");
  const ref = await getReferenceBrand(actor.workspaceId);
  if (!ref) throw new HttpError(409, "Choose your brand first — protection alerts are measured against it.", "no_reference_brand");
  await db.update(workspaces).set({ settings: sql`${workspaces.settings} || '{"brandProtection": true}'::jsonb` }).where(eq(workspaces.id, actor.workspaceId));
  const rec = await reconcileReferenceMarket(actor);
  const groups = rec.cohorts.filter((c) => c.groupId).map((c) => ({ id: c.groupId!, name: c.name }));
  const activeRules = await db.transaction((tx) => syncProtectionRules(tx, actor, { groups, enabled: true, resume: true }));
  await logActivity({ workspaceId: actor.workspaceId, actorUserId: actor.userId, kind: "brand_protection", message: `Turned on Protect My Brand for ${ref.name} (${groups.length} comparison${groups.length === 1 ? "" : "s"}, ${activeRules} rules)` });
  return { groups: groups.length, activeRules, unmatched: rec.unmatched.length };
}

/** Turn the pack off: pauses the managed rules (history kept). */
export async function disableProtection(actor: { workspaceId: string; userId: string | null }) {
  await db.transaction(async (tx) => {
    await tx.update(workspaces).set({ settings: sql`${workspaces.settings} || '{"brandProtection": false}'::jsonb` }).where(eq(workspaces.id, actor.workspaceId));
    await tx.update(alertRules).set({ paused: true }).where(and(eq(alertRules.workspaceId, actor.workspaceId), like(alertRules.managedKey, `${KEY_PREFIX}%`)));
  });
  await logActivity({ workspaceId: actor.workspaceId, actorUserId: actor.userId, kind: "brand_protection", message: "Turned off Protect My Brand" });
}

export interface ProtectionStatus {
  enabled: boolean;
  brand: { id: string; name: string } | null;
  groups: { id: string; name: string }[];
  rules: { type: ProtectionType; active: number; paused: number; fired: number; lastTriggeredAt: string | null }[];
  events: { id: string; ruleId: string; type: ProtectionType; groupName: string | null; headline: string; detail: string | null; firedAt: string; isSimulated: boolean; deliveredChannels: string[] }[];
  /** Protection alerts fired in the last 7 days. */
  fired7d: number;
}

export async function protectionStatus(workspaceId: string): Promise<ProtectionStatus> {
  const { getReferenceBrand } = await import("../brand/reference");
  const [ref, [ws], groups, rules] = await Promise.all([
    getReferenceBrand(workspaceId),
    db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)),
    activeManagedGroups(db, workspaceId),
    db.select().from(alertRules).where(and(eq(alertRules.workspaceId, workspaceId), like(alertRules.managedKey, `${KEY_PREFIX}%`))),
  ]);
  const ruleIds = rules.map((r) => r.id);
  const counts = ruleIds.length
    ? await db.select({ ruleId: alertEvents.ruleId, n: sql<number>`count(*)::int` }).from(alertEvents).where(and(inArray(alertEvents.ruleId, ruleIds), eq(alertEvents.isTest, false))).groupBy(alertEvents.ruleId)
    : [];
  const fired = new Map(counts.map((c) => [c.ruleId, c.n]));
  const [{ n: fired7d } = { n: 0 }] = ruleIds.length
    ? await db.select({ n: sql<number>`count(*)::int` }).from(alertEvents).where(and(inArray(alertEvents.ruleId, ruleIds), eq(alertEvents.isTest, false), sql`${alertEvents.firedAt} >= now() - interval '7 days'`))
    : [];
  const events = ruleIds.length ? await db.select().from(alertEvents).where(and(inArray(alertEvents.ruleId, ruleIds), eq(alertEvents.isTest, false))).orderBy(desc(alertEvents.firedAt)).limit(20) : [];
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const latest = (rs: AlertRule[]) => rs.map((r) => r.lastTriggeredAt).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null;
  return {
    enabled: Boolean(ws?.settings.brandProtection),
    brand: ref ? { id: ref.id, name: ref.name } : null,
    groups,
    fired7d,
    rules: PROTECTION_TYPES.map((type) => {
      const rs = rules.filter((r) => r.type === type);
      return { type, active: rs.filter((r) => !r.paused).length, paused: rs.filter((r) => r.paused).length, fired: rs.reduce((s, r) => s + (fired.get(r.id) ?? 0), 0), lastTriggeredAt: latest(rs) };
    }),
    events: events.map((e) => {
      const r = ruleById.get(e.ruleId)!;
      return { id: e.id, ruleId: e.ruleId, type: r.type as ProtectionType, groupName: r.groupId ? (groupName.get(r.groupId) ?? null) : null, headline: e.headline, detail: e.detail, firedAt: e.firedAt.toISOString(), isSimulated: e.isSimulated, deliveredChannels: e.deliveredChannels };
    }),
  };
}

/** True for rules the pack owns; the Rules list labels them and the editor keeps their type fixed. */
export function isManagedRule(rule: Pick<AlertRule, "managedKey">) {
  return Boolean(rule.managedKey?.startsWith(KEY_PREFIX));
}

