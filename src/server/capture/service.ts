import "server-only";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { PRICE_SELECTORS } from "@/lib/capture/bookmarklet";
import { formatMoney } from "@/lib/money";
import { logActivity } from "../activity";
import { evaluateAlertsForListings } from "../alerts/engine";
import { writeObservation } from "../catalog/persist";
import { db } from "../db/client";
import { listings, priceCaptures, productFamilies, variants } from "../db/schema";
import { env } from "../env";
import { logger } from "../logger";
import type { AppContext } from "../workspace/context";

/**
 * Recording a price the owner captured from an Amazon.in product page with the
 * bookmarklet. Aisle never fetches the page itself: everything here arrives in
 * the request body, is validated, and is stored as a verified (not simulated)
 * observation labelled source = "user-capture".
 */

const AMAZON_IN = /^https:\/\/([a-z0-9-]+\.)?amazon\.in\//i;

export const captureSchema = z.object({
  asin: z.string().regex(/^[A-Z0-9]{10}$/, "ASIN must be 10 capital letters or digits"),
  title: z.string().trim().max(500).nullable().optional(),
  priceMinor: z.number().int().nonnegative().max(1_000_000_000).nullable(),
  currency: z.literal("INR"),
  url: z.string().max(2048).regex(AMAZON_IN, "Only amazon.in product pages can be captured"),
  variantLabel: z.string().trim().max(200).nullable().optional(),
  availability: z.string().trim().max(300).nullable().optional(),
  capturedAt: z.string().datetime({ offset: true }),
  selector: z.enum(PRICE_SELECTORS).nullable().optional(),
  isDeal: z.boolean().optional().default(false),
});
export type CaptureInput = z.infer<typeof captureSchema>;

/** Map the page's availability text to Aisle's states. Anything unclear stays "unknown" — never "out of stock". */
export function availabilityFrom(text: string | null | undefined): "in_stock" | "out_of_stock" | "limited" | "preorder" | "unknown" {
  const t = (text ?? "").toLowerCase();
  if (/currently unavailable|out of stock|unavailable/.test(t)) return "out_of_stock";
  if (/only \d+ left|few left/.test(t)) return "limited";
  if (/pre-?order|will be released/.test(t)) return "preorder";
  if (/in stock|available/.test(t)) return "in_stock";
  return "unknown";
}

/** The browser's clock decides "when", unless it's implausible; then the server's receipt time is used. */
const MAX_SKEW_MS = 10 * 60_000;
const DUPLICATE_WINDOW_MS = 2 * 60_000;

export type CaptureResult =
  | { status: "recorded" | "duplicate"; variantId: string; familyId: string; variant: string; observedAt: string }
  | { status: "untracked"; asin: string; importUrl: string };

export async function recordCapture(ctx: AppContext, input: CaptureInput, now = new Date()): Promise<CaptureResult> {
  const clientAt = new Date(input.capturedAt);
  const observedAt = Math.abs(clientAt.getTime() - now.getTime()) <= MAX_SKEW_MS ? clientAt : now;
  const availability = availabilityFrom(input.availability);
  const base = { workspaceId: ctx.workspace.id, userId: ctx.user.id, asin: input.asin, marketplace: "IN", title: input.title ?? null, priceMinor: input.priceMinor, currency: input.currency, isDeal: input.isDeal, selector: input.selector ?? null, variantLabel: input.variantLabel ?? null, availabilityText: input.availability ?? null, availability, url: input.url, capturedAt: clientAt };

  const [match] = await db
    .select({ variantId: variants.id, listingId: variants.listingId, familyId: productFamilies.id, label: variants.label, title: productFamilies.title })
    .from(variants)
    .innerJoin(listings, eq(listings.id, variants.listingId))
    .innerJoin(productFamilies, eq(productFamilies.id, variants.familyId))
    .where(and(eq(variants.workspaceId, ctx.workspace.id), eq(variants.tracked, true), isNull(productFamilies.archivedAt), eq(listings.marketplace, "IN"), eq(listings.asin, input.asin)));
  if (!match) {
    await db.insert(priceCaptures).values({ ...base, status: "untracked" });
    return { status: "untracked", asin: input.asin, importUrl: `${env.BETTER_AUTH_URL}/products?import=${encodeURIComponent(`https://www.amazon.in/dp/${input.asin}`)}` };
  }
  const name = `${match.title.split(",")[0]} · ${match.label}`;

  // A double click shouldn't record the same reading twice.
  const [recent] = await db
    .select({ id: priceCaptures.id, priceMinor: priceCaptures.priceMinor, availability: priceCaptures.availability })
    .from(priceCaptures)
    .where(and(eq(priceCaptures.workspaceId, ctx.workspace.id), eq(priceCaptures.listingId, match.listingId), eq(priceCaptures.status, "recorded"), gte(priceCaptures.receivedAt, new Date(now.getTime() - DUPLICATE_WINDOW_MS))))
    .orderBy(desc(priceCaptures.receivedAt))
    .limit(1);
  if (recent && recent.priceMinor === input.priceMinor && recent.availability === availability) {
    await db.insert(priceCaptures).values({ ...base, status: "duplicate", variantId: match.variantId, listingId: match.listingId });
    return { status: "duplicate", variantId: match.variantId, familyId: match.familyId, variant: match.label, observedAt: observedAt.toISOString() };
  }

  const obs = await writeObservation(
    db,
    match.listingId,
    "IN",
    {
      observedAt,
      currency: "INR",
      priceMinor: input.priceMinor,
      priceBasis: input.priceMinor === null ? "none" : "buy_box",
      amazonPriceMinor: null,
      lowestNewPriceMinor: null,
      listPriceMinor: null,
      dealPriceMinor: input.isDeal ? input.priceMinor : null,
      primeExclusivePriceMinor: null,
      shippingMinor: null,
      availability,
      seller: null,
    },
    { provider: "capture", source: "user-capture", requestedAt: now, providerUpdatedAt: observedAt, isSimulated: false },
  );
  await db.insert(priceCaptures).values({ ...base, status: "recorded", variantId: match.variantId, listingId: match.listingId, observationId: obs.observationId });
  await logActivity({
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    kind: "price_captured",
    message: `Captured ${input.priceMinor === null ? `availability (${input.availability ?? "unknown"})` : formatMoney(input.priceMinor, "INR")} for ${name} from Amazon.in`,
    entityType: "family",
    entityId: match.familyId,
    metadata: { variantId: match.variantId, priceMinor: input.priceMinor, selector: input.selector ?? null, isDeal: input.isDeal },
  });
  await evaluateAlertsForListings([match.listingId], { trigger: "manual" }).catch((e) => logger.error({ err: e }, "alert evaluation after capture failed"));
  return { status: "recorded", variantId: match.variantId, familyId: match.familyId, variant: match.label, observedAt: observedAt.toISOString() };
}

export async function recentCaptures(workspaceId: string, limit = 25) {
  return db
    .select({ id: priceCaptures.id, status: priceCaptures.status, asin: priceCaptures.asin, title: priceCaptures.title, priceMinor: priceCaptures.priceMinor, currency: priceCaptures.currency, isDeal: priceCaptures.isDeal, selector: priceCaptures.selector, variantLabel: priceCaptures.variantLabel, availabilityText: priceCaptures.availabilityText, capturedAt: priceCaptures.capturedAt, receivedAt: priceCaptures.receivedAt, variantId: priceCaptures.variantId, familyId: variants.familyId, aisleVariant: variants.label, familyTitle: productFamilies.title })
    .from(priceCaptures)
    .leftJoin(variants, eq(variants.id, priceCaptures.variantId))
    .leftJoin(productFamilies, eq(productFamilies.id, variants.familyId))
    .where(eq(priceCaptures.workspaceId, workspaceId))
    .orderBy(desc(priceCaptures.receivedAt))
    .limit(limit);
}
