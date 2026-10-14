import "server-only";
import { logger } from "../logger";
import { reconcileIfConfigured, type Actor } from "./reference";

/**
 * Keep the managed "{Brand} vs Market" comparisons current after catalog
 * changes. Never fails the change that triggered it: a reconcile error is
 * logged, and the next change (or the next manual reconcile) retries.
 */
export async function reconcileAfterChange(actor: Actor) {
  try {
    return await reconcileIfConfigured(actor);
  } catch (e) {
    logger.error({ err: e, workspace: actor.workspaceId }, "reference-market reconcile failed");
    return null;
  }
}
