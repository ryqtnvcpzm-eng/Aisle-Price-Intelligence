import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { listingKey, parseManyInputs, type ParsedProductInput } from "@/lib/amazon-url";
import { getMarketplace, isMarketplaceCode, type MarketplaceCode } from "@/lib/marketplaces";
import { defaultBasisFor, parseQuantities, primaryQuantity, unitPriceMinor, type ParsedQuantity } from "@/lib/quantity";
import { logActivity } from "../activity";
import { resolveShortLink } from "../amazon/resolve";
import { cacheGet, cacheSet } from "../redis";
import { db } from "../db/client";
import {
  brands,
  categories,
  comparisonGroups,
  comparisonItems,
  listings,
  productFamilies,
  variantQuantities,
  variants,
} from "../db/schema";
import { getActiveProvider, getProvider, ProviderError, type PriceSnapshot, type ProviderId, type ProviderProduct, type VariationFamily } from "../providers";
import { HttpError } from "../errors";
import type { AppContext } from "../workspace/context";
import { reconcileAfterChange } from "../brand/hooks";
import { quantitiesFor, variantLabel } from "./normalize";
import { rescheduleListings, upsertListing, writeObservation } from "./persist";

export { quantitiesFor, variantLabel };

const MAX_INPUTS = 25;
const MAX_CHILDREN = 60;
const PREVIEW_TTL_SECONDS = 20 * 60;

export interface PreviewVariant {
  asin: string;
  label: string;
  attributes: Record<string, string>;
  title: string | null;
  imageUrl: string | null;
  priceMinor: number | null;
  listPriceMinor: number | null;
  currency: string;
  availability: string;
  sellerName: string | null;
  sellerIsAmazon: boolean | null;
  quantity: ParsedQuantity | null;
  unitPriceMinor: number | null;
  unitBasis: string | null;
  isPrimary: boolean;
  alreadyTracked: boolean;
  trackedInGroups: string[];
  status: string;
}

export interface PreviewFamily {
  key: string;
  input: string;
  marketplace: MarketplaceCode;
  marketplaceDetected: boolean;
  provider: ProviderId;
  isSimulated: boolean;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  categoryPath: string[] | null;
  parentAsin: string | null;
  primaryAsin: string;
  dimensions: string[];
  discovery: { completeness: VariationFamily["completeness"]; note: string; reportedTotal: number | null; shown: number };
  providerUpdatedAt: string | null;
  requestedAt: string;
  variants: PreviewVariant[];
  existingFamilyId: string | null;
}

export interface PreviewError {
  input: string;
  code: string;
  message: string;
}

export interface ImportPreview {
  previewId: string;
  families: PreviewFamily[];
  errors: PreviewError[];
  duplicates: string[];
}

/** Server-side cache of exactly what the provider returned, so commit never re-buys the data. */
interface CachedPreview {
  workspaceId: string;
  provider: ProviderId;
  products: Record<string, ProviderProduct & { snapshot: (PriceSnapshot & { observedAt: string }) | null }>;
  history: Record<string, (PriceSnapshot & { observedAt: string })[]>;
  families: Record<string, { family: VariationFamily; marketplace: MarketplaceCode }>;
}

function reviveSnapshot<T extends { observedAt: string | Date }>(s: T): Omit<T, "observedAt"> & { observedAt: Date } {
  return { ...s, observedAt: new Date(s.observedAt) };
}

/**
 * `discoverVariants: false` (bulk imports that keep only the pasted listing)
 * skips the extra variation and sibling lookups, so a large import costs one
 * provider lookup per link instead of up to one per size and flavour.
 */
export async function previewImport(ctx: AppContext, rawInput: string, marketplaceOverride: MarketplaceCode | null, opts: { discoverVariants?: boolean } = {}): Promise<ImportPreview> {
  const discover = opts.discoverVariants ?? true;
  const defaultMp = marketplaceOverride ?? (isMarketplaceCode(ctx.workspace.defaultMarketplace) ? ctx.workspace.defaultMarketplace : "IN");
  const parsed = parseManyInputs(rawInput, defaultMp).slice(0, MAX_INPUTS);
  const errors: PreviewError[] = [];
  const duplicates: string[] = [];
  const targets: Extract<ParsedProductInput, { kind: "listing" }>[] = [];
  const seen = new Set<string>();

  for (const p of parsed) {
    let item: ParsedProductInput | { kind: "error"; input: string; code: string; message: string } = p;
    if (item.kind === "short_link") item = await resolveShortLink(item.url, defaultMp);
    if (item.kind === "error") {
      errors.push({ input: item.input, code: item.code, message: item.message });
      continue;
    }
    if (item.kind !== "listing") continue;
    // An explicit override wins over the URL's storefront only for bare ASINs.
    const listing = item.source === "asin" && marketplaceOverride ? { ...item, marketplace: marketplaceOverride } : item;
    const key = listingKey(listing.marketplace, listing.asin);
    if (seen.has(key)) {
      duplicates.push(item.input);
      continue;
    }
    seen.add(key);
    targets.push(listing);
  }

  if (!targets.length) return { previewId: "", families: [], errors, duplicates };

  const provider = getActiveProvider();
  const cache: CachedPreview = { workspaceId: ctx.workspace.id, provider: provider.id, products: {}, history: {}, families: {} };
  const families: PreviewFamily[] = [];

  const byMarketplace = new Map<MarketplaceCode, typeof targets>();
  for (const t of targets) {
    if (!provider.supportsMarketplace(t.marketplace)) {
      errors.push({ input: t.input, code: "unsupported_marketplace", message: `${provider.label} doesn't cover ${getMarketplace(t.marketplace).name}. Choose another marketplace or configure a provider that does.` });
      continue;
    }
    byMarketplace.set(t.marketplace, [...(byMarketplace.get(t.marketplace) ?? []), t]);
  }

  for (const [marketplace, items] of byMarketplace) {
    let batch;
    try {
      batch = await provider.getProducts(marketplace, items.map((i) => i.asin), { history: provider.capabilities.priceHistory && provider.capabilities.monitoring, historyDays: 90 });
    } catch (e) {
      const msg = e instanceof ProviderError ? e.userMessage : "The data provider couldn't be reached.";
      for (const i of items) errors.push({ input: i.input, code: e instanceof ProviderError ? e.kind : "provider_error", message: msg });
      continue;
    }
    const productsByAsin = new Map(batch.products.map((p) => [p.asin, p]));

    for (const target of items) {
      const product = productsByAsin.get(target.asin);
      if (!product || product.status === "not_found" || product.status === "invalid") {
        errors.push({ input: target.input, code: "not_found", message: `No product found for ${target.asin} on ${getMarketplace(marketplace).name}. The listing may be removed, or the ASIN belongs to another marketplace.` });
        continue;
      }
      let family = batch.variations.get(target.asin);
      if (discover && (!family || family.completeness === "unavailable")) {
        try {
          if (provider.capabilities.variations) family = await provider.getVariations(marketplace, target.asin);
        } catch {
          /* keep what we have */
        }
      }
      family ??= { parentAsin: product.parentAsin, dimensions: [], children: [{ asin: product.asin, attributes: product.variationAttributes ?? {} }], completeness: "unavailable", note: "Variation discovery isn't available from this provider.", reportedTotal: null };

      // Fetch details for siblings we don't have yet (capped to protect provider budget).
      const childAsins = family.children.map((c) => c.asin).slice(0, MAX_CHILDREN);
      const missing = discover ? childAsins.filter((a) => !productsByAsin.has(a)) : [];
      if (missing.length) {
        try {
          const more = await provider.getProducts(marketplace, missing, { history: provider.capabilities.priceHistory && provider.capabilities.monitoring, historyDays: 90 });
          for (const p of more.products) productsByAsin.set(p.asin, p);
          for (const [a, h] of more.history) batch.history.set(a, h);
        } catch {
          /* show children without prices rather than failing the whole preview */
        }
      }
      const capped = family.children.length > MAX_CHILDREN;

      const familyKey = family.parentAsin ?? product.asin;
      const [existingFamily] = await db
        .select({ id: productFamilies.id })
        .from(productFamilies)
        .where(and(eq(productFamilies.workspaceId, ctx.workspace.id), eq(productFamilies.marketplace, marketplace), eq(productFamilies.familyKey, familyKey)));

      // Which of these ASINs does this workspace already track, and in which groups?
      const tracked = await db
        .select({ asin: listings.asin, groupName: comparisonGroups.name })
        .from(variants)
        .innerJoin(listings, eq(listings.id, variants.listingId))
        .leftJoin(comparisonItems, eq(comparisonItems.variantId, variants.id))
        .leftJoin(comparisonGroups, eq(comparisonGroups.id, comparisonItems.groupId))
        .where(and(eq(variants.workspaceId, ctx.workspace.id), eq(listings.marketplace, marketplace), inArray(listings.asin, childAsins.length ? childAsins : [product.asin])));
      const trackedMap = new Map<string, string[]>();
      for (const t of tracked) trackedMap.set(t.asin, [...(trackedMap.get(t.asin) ?? []), ...(t.groupName ? [t.groupName] : [])]);

      const pv: PreviewVariant[] = childAsins.map((asin) => {
        const child = family!.children.find((c) => c.asin === asin)!;
        const p = productsByAsin.get(asin);
        const attrs = Object.keys(child.attributes).length ? child.attributes : (p?.variationAttributes ?? {});
        const qs = p ? quantitiesFor({ ...p, variationAttributes: attrs }) : parseQuantities(Object.values(attrs).join(" "));
        const q = primaryQuantity(qs);
        const basis = defaultBasisFor(q?.dimension);
        const snap = p?.snapshot ?? null;
        return {
          asin,
          label: variantLabel(attrs, p?.sizeText ?? null),
          attributes: attrs,
          title: p?.title ?? null,
          imageUrl: p?.imageUrl ?? null,
          priceMinor: snap?.priceMinor ?? null,
          listPriceMinor: snap?.listPriceMinor ?? null,
          currency: snap?.currency ?? getMarketplace(marketplace).currency,
          availability: p ? (snap?.availability ?? "unknown") : "unknown",
          sellerName: snap?.seller?.name ?? null,
          sellerIsAmazon: snap?.seller?.isAmazon ?? null,
          quantity: q,
          unitPriceMinor: basis && q ? unitPriceMinor(snap?.priceMinor, q, basis) : null,
          unitBasis: basis,
          isPrimary: asin === target.asin,
          alreadyTracked: trackedMap.has(asin),
          trackedInGroups: [...new Set(trackedMap.get(asin) ?? [])],
          status: p ? p.status : "no_data",
        };
      });
      // Make sure the pasted listing is present even if the family list omitted it.
      if (!pv.some((v) => v.asin === target.asin)) {
        const qs = quantitiesFor(product);
        const q = primaryQuantity(qs);
        const basis = defaultBasisFor(q?.dimension);
        pv.unshift({
          asin: product.asin,
          label: variantLabel(product.variationAttributes, product.sizeText),
          attributes: product.variationAttributes ?? {},
          title: product.title,
          imageUrl: product.imageUrl,
          priceMinor: product.snapshot?.priceMinor ?? null,
          listPriceMinor: product.snapshot?.listPriceMinor ?? null,
          currency: product.snapshot?.currency ?? getMarketplace(marketplace).currency,
          availability: product.snapshot?.availability ?? "unknown",
          sellerName: product.snapshot?.seller?.name ?? null,
          sellerIsAmazon: product.snapshot?.seller?.isAmazon ?? null,
          quantity: q,
          unitPriceMinor: basis && q ? unitPriceMinor(product.snapshot?.priceMinor, q, basis) : null,
          unitBasis: basis,
          isPrimary: true,
          alreadyTracked: trackedMap.has(product.asin),
          trackedInGroups: trackedMap.get(product.asin) ?? [],
          status: product.status,
        });
      }

      const key = listingKey(marketplace, target.asin);
      cache.families[key] = { family, marketplace };
      for (const v of pv) {
        const p = productsByAsin.get(v.asin);
        if (p) cache.products[listingKey(marketplace, v.asin)] = p as CachedPreview["products"][string];
        const h = batch.history.get(v.asin);
        if (h) cache.history[listingKey(marketplace, v.asin)] = h as CachedPreview["history"][string];
      }

      families.push({
        key,
        input: target.input,
        marketplace,
        marketplaceDetected: target.marketplaceDetected,
        provider: provider.id,
        isSimulated: provider.isSimulated,
        title: (product.title ?? `Listing ${product.asin}`).replace(/ — [^—]+$/, ""),
        brand: product.brand,
        imageUrl: product.imageUrl,
        categoryPath: product.categoryPath,
        parentAsin: family.parentAsin,
        primaryAsin: target.asin,
        dimensions: family.dimensions,
        discovery: {
          completeness: capped ? "partial" : family.completeness,
          note: capped ? `${family.note} Showing the first ${MAX_CHILDREN} to protect your provider budget.` : family.note,
          reportedTotal: family.reportedTotal,
          shown: pv.length,
        },
        providerUpdatedAt: product.providerUpdatedAt?.toISOString() ?? null,
        requestedAt: batch.requestedAt.toISOString(),
        variants: pv,
        existingFamilyId: existingFamily?.id ?? null,
      });
    }
  }

  const previewId = families.length ? randomUUID() : "";
  if (previewId) await cacheSet(`import:${previewId}`, cache, PREVIEW_TTL_SECONDS);
  return { previewId, families, errors, duplicates };
}

// ─── Commit ─────────────────────────────────────────────────────────────────

export const commitSchema = z.object({
  previewId: z.string().uuid(),
  families: z
    .array(
      z.object({
        key: z.string().min(3).max(40),
        asins: z.array(z.string().regex(/^[A-Z0-9]{10}$/)).min(1).max(MAX_CHILDREN),
        brandName: z.string().trim().max(80).optional(),
        categoryName: z.string().trim().max(80).optional(),
      }),
    )
    .min(1)
    .max(MAX_INPUTS),
  groupId: z.string().uuid().optional(),
  newGroupName: z.string().trim().min(1).max(80).optional(),
  intervalMinutes: z.union([z.literal(60), z.literal(180), z.literal(360), z.literal(720), z.literal(1440), z.null()]).default(60),
});
export type CommitInput = z.infer<typeof commitSchema>;

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "item";
}

export async function commitImport(ctx: AppContext, input: CommitInput, opts: { skipReconcile?: boolean } = {}) {
  const cached = await cacheGet<CachedPreview>(`import:${input.previewId}`);
  if (!cached || cached.workspaceId !== ctx.workspace.id) {
    throw new HttpError(410, "This preview expired. Paste the link again to refresh it.", "preview_expired");
  }
  const provider = getProvider(cached.provider);
  const requestedAt = new Date();
  const result = await db.transaction(async (tx) => {
    const familyIds: string[] = [];
    const brandIds: string[] = [];
    const variantIds: string[] = [];
    const listingIds: string[] = [];
    let groupId = input.groupId ?? null;

    if (groupId) {
      const [g] = await tx.select({ id: comparisonGroups.id }).from(comparisonGroups).where(and(eq(comparisonGroups.id, groupId), eq(comparisonGroups.workspaceId, ctx.workspace.id)));
      if (!g) throw new HttpError(404, "Comparison group not found.");
    } else if (input.newGroupName) {
      const first = input.families[0]!;
      const fam = cached.families[first.key];
      const [g] = await tx
        .insert(comparisonGroups)
        .values({ workspaceId: ctx.workspace.id, name: input.newGroupName, marketplace: fam?.marketplace ?? null, basis: ctx.workspace.defaultBasis, createdBy: ctx.user.id })
        .returning({ id: comparisonGroups.id });
      groupId = g!.id;
    }

    for (const sel of input.families) {
      const fam = cached.families[sel.key];
      if (!fam) throw new HttpError(400, "Selection doesn't match the preview.", "invalid_selection");
      const marketplace = fam.marketplace;
      const primary = cached.products[sel.key];
      if (!primary) throw new HttpError(400, "Selection doesn't match the preview.", "invalid_selection");

      const brandName = sel.brandName || primary.brand || null;
      let brandId: string | null = null;
      if (brandName) {
        const [b] = await tx
          .insert(brands)
          .values({ workspaceId: ctx.workspace.id, name: brandName, slug: slugify(brandName) })
          .onConflictDoUpdate({ target: [brands.workspaceId, brands.slug], set: { name: sql`${brands.name}` } })
          .returning({ id: brands.id });
        brandId = b!.id;
        brandIds.push(brandId);
      }
      const categoryName = sel.categoryName || primary.categoryPath?.at(-1) || null;
      let categoryId: string | null = null;
      if (categoryName) {
        const [c] = await tx
          .insert(categories)
          .values({ workspaceId: ctx.workspace.id, name: categoryName, slug: slugify(categoryName) })
          .onConflictDoUpdate({ target: [categories.workspaceId, categories.slug], set: { name: sql`${categories.name}` } })
          .returning({ id: categories.id });
        categoryId = c!.id;
      }

      const familyKey = fam.family.parentAsin ?? primary.asin;
      const [familyRow] = await tx
        .insert(productFamilies)
        .values({
          workspaceId: ctx.workspace.id,
          marketplace,
          familyKey,
          parentAsin: fam.family.parentAsin,
          title: (primary.title ?? `Listing ${primary.asin}`).replace(/ — [^—]+$/, ""),
          brandId,
          categoryId,
          imageUrl: primary.imageUrl,
          variationDimensions: fam.family.dimensions,
          discoveryStatus: fam.family.completeness,
          discoveredCount: fam.family.children.length,
          provider: cached.provider,
          isSimulated: primary.isSimulated,
        })
        .onConflictDoUpdate({
          target: [productFamilies.workspaceId, productFamilies.marketplace, productFamilies.familyKey],
          set: {
            discoveryStatus: fam.family.completeness,
            discoveredCount: fam.family.children.length,
            variationDimensions: fam.family.dimensions,
            archivedAt: null,
            brandId: sql`coalesce(${productFamilies.brandId}, excluded.brand_id)`,
            categoryId: sql`coalesce(${productFamilies.categoryId}, excluded.category_id)`,
          },
        })
        .returning({ id: productFamilies.id });
      familyIds.push(familyRow!.id);

      for (const asin of sel.asins) {
        const key = listingKey(marketplace, asin);
        const product = cached.products[key];
        if (!product) continue; // child without provider data: can't be tracked honestly
        const listingId = await upsertListing(tx, { ...product, providerUpdatedAt: product.providerUpdatedAt ? new Date(product.providerUpdatedAt) : null, snapshot: null }, cached.provider);
        listingIds.push(listingId);

        const meta = { provider: cached.provider, requestedAt, providerUpdatedAt: product.providerUpdatedAt ? new Date(product.providerUpdatedAt) : null, isSimulated: product.isSimulated };
        for (const h of cached.history[key] ?? []) {
          await writeObservation(tx, listingId, marketplace, reviveSnapshot(h), { ...meta, source: "backfill" });
        }
        if (product.snapshot) await writeObservation(tx, listingId, marketplace, reviveSnapshot(product.snapshot), { ...meta, source: "import" });
        await tx.update(listings).set({ lastRequestedAt: requestedAt, lastSuccessAt: requestedAt, consecutiveFailures: 0 }).where(eq(listings.id, listingId));

        const child = fam.family.children.find((c) => c.asin === asin);
        const attrs = child && Object.keys(child.attributes).length ? child.attributes : (product.variationAttributes ?? {});
        const [variantRow] = await tx
          .insert(variants)
          .values({
            workspaceId: ctx.workspace.id,
            familyId: familyRow!.id,
            listingId,
            label: variantLabel(attrs, product.sizeText),
            attributes: attrs,
            tracked: true,
            intervalMinutes: provider.capabilities.monitoring ? input.intervalMinutes : null,
          })
          .onConflictDoUpdate({ target: [variants.workspaceId, variants.listingId], set: { tracked: true, hidden: false, familyId: familyRow!.id } })
          .returning({ id: variants.id });
        variantIds.push(variantRow!.id);

        for (const q of quantitiesFor({ ...product, variationAttributes: attrs })) {
          await tx
            .insert(variantQuantities)
            .values({
              variantId: variantRow!.id,
              dimension: q.dimension,
              packCount: q.packCount,
              unitAmount: String(q.unitAmount),
              unit: q.unit,
              totalMilli: q.totalMilli,
              countNoun: q.countNoun ?? null,
              sourceText: q.sourceText,
              matchedText: q.matchedText,
              confidence: "parsed",
            })
            .onConflictDoNothing(); // never overwrite a manual correction
        }

        if (groupId) {
          await tx.insert(comparisonItems).values({ groupId, variantId: variantRow!.id, status: "confirmed" }).onConflictDoNothing();
        }
      }
    }

    await rescheduleListings(tx, listingIds);
    await logActivity(
      {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.user.id,
        kind: "import",
        message: `Imported ${variantIds.length} variant${variantIds.length === 1 ? "" : "s"} across ${familyIds.length} product${familyIds.length === 1 ? "" : "s"}`,
        entityType: "family",
        entityId: familyIds[0],
        metadata: { familyIds, provider: cached.provider },
        isSimulated: provider.isSimulated,
      },
      tx,
    );
    return { familyIds, variantIds, groupId, brandIds: [...new Set(brandIds)] };
  });
  if (!opts.skipReconcile) await reconcileAfterChange({ workspaceId: ctx.workspace.id, userId: ctx.user.id });
  return result;
}
