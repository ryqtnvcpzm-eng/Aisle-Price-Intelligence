/**
 * Aisle relational model.
 *
 * Two layers:
 *  - A **shared catalog** keyed by marketplace + ASIN (`listings`, `price_observations`,
 *    `offers`, `sellers`). It is polled once no matter how many workspaces track it,
 *    so provider spend is deduplicated.
 *  - **Workspace-scoped** analysis objects (`product_families`, `variants`,
 *    `comparison_groups`, alerts, reports...). Every query on these filters by
 *    `workspace_id`.
 *
 * Money: integer minor units (`integer`), never floats.
 * Quantities: integer milli-base units (`bigint` mg / µl / milli-count).
 */
import { sql } from "drizzle-orm";
import type { BriefingContent } from "@/lib/briefing-types";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date());

// ─── Enums ──────────────────────────────────────────────────────────────────

export const memberRole = pgEnum("member_role", ["owner", "admin", "analyst", "viewer"]);
export const listingStatus = pgEnum("listing_status", ["active", "unavailable", "discontinued", "not_found", "invalid"]);
export const availability = pgEnum("availability", ["in_stock", "out_of_stock", "limited", "preorder", "unknown"]);
export const discoveryStatus = pgEnum("discovery_status", ["complete", "partial", "unavailable", "single"]);
export const quantityConfidence = pgEnum("quantity_confidence", ["provider", "parsed", "manual", "unknown"]);
export const dimension = pgEnum("quantity_dimension", ["mass", "volume", "count", "serving"]);
export const priceBasis = pgEnum("price_basis", ["buy_box", "amazon", "lowest_new", "none"]);
export const itemRole = pgEnum("comparison_role", ["reference", "competitor"]);
export const itemStatus = pgEnum("comparison_item_status", ["confirmed", "suggested"]);
export const jobKind = pgEnum("job_kind", ["scheduled", "manual", "import", "backfill"]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "partial", "failed", "skipped"]);
export const requestStatus = pgEnum("provider_request_status", ["ok", "error", "rate_limited", "quota_exhausted", "auth_error", "timeout"]);
export const observationSource = pgEnum("observation_source", ["poll", "import", "backfill", "manual", "user-capture"]);
export const alertType = pgEnum("alert_type", [
  "price_below",
  "price_above",
  "pct_drop",
  "pct_rise",
  "daily_move",
  "competitor_undercut",
  "gap_exceeds",
  "leader_change",
  "historical_low",
  "out_of_stock",
  "back_in_stock",
  "stale_data",
  "quota_exhausted",
  "monitoring_failures",
  // "Protect My Brand" pack (managed rules scoped to the workspace's reference-brand cohorts).
  "price_leadership_change",
  "reference_out_of_stock",
  "rival_drop_5pct",
]);
export const alertFrequency = pgEnum("alert_frequency", ["instant", "daily", "weekly"]);
export const reportFormat = pgEnum("report_format", ["csv", "xlsx", "pdf"]);
export const deliveryStatus = pgEnum("delivery_status", ["pending", "sending", "sent", "failed", "skipped"]);
export const importJobStatus = pgEnum("import_job_status", ["queued", "running", "paused", "completed", "cancelled", "failed"]);
export const importItemStatus = pgEnum("import_item_status", ["pending", "processing", "succeeded", "failed", "skipped", "cancelled"]);

// ─── Auth (Better Auth core schema) ─────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─── Workspaces ─────────────────────────────────────────────────────────────

export interface WorkspaceSettings {
  defaultIntervalMinutes: number;
  marketplaceIntervals?: Record<string, number>;
  digest: "off" | "daily" | "weekly";
  emailAlerts: boolean;
  exportIncludeMethodology: boolean;
  significantChangePct: number;
  /** "Protect My Brand" pack switch; the managed rules themselves live in `alert_rules`. */
  brandProtection?: boolean;
  /** Email the Monday Briefing to members (real data only, and only when email is configured). */
  emailBriefing?: boolean;
}

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  defaultMarketplace: text("default_marketplace").notNull().default("IN"),
  defaultCurrency: text("default_currency"),
  defaultBasis: text("default_basis").notNull().default("per_100g"),
  timeZone: text("time_zone").notNull().default("Asia/Kolkata"),
  settings: jsonb("settings")
    .$type<WorkspaceSettings>()
    .notNull()
    .default({ defaultIntervalMinutes: 60, digest: "daily", emailAlerts: false, exportIncludeMethodology: true, significantChangePct: 3 }),
  onboardedAt: ts("onboarded_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("analyst"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("members_user_idx").on(t.userId)],
);

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** The workspace's own brand ("My Brand"). At most one per workspace, enforced by a partial unique index. */
    isReference: boolean("is_reference").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("brands_ws_slug_uq").on(t.workspaceId, t.slug), uniqueIndex("brands_ws_reference_uq").on(t.workspaceId).where(sql`${t.isReference}`)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("categories_ws_slug_uq").on(t.workspaceId, t.slug)],
);

// ─── Shared catalog ─────────────────────────────────────────────────────────

export const sellers = pgTable(
  "sellers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketplace: text("marketplace").notNull(),
    sellerId: text("seller_id").notNull(),
    name: text("name"),
    isAmazon: boolean("is_amazon").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sellers_mp_sid_uq").on(t.marketplace, t.sellerId)],
);

/** One purchasable Amazon listing: marketplace + ASIN. Shared across workspaces. */
export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketplace: text("marketplace").notNull(),
    asin: text("asin").notNull(),
    parentAsin: text("parent_asin"),
    title: text("title"),
    brandName: text("brand_name"),
    imageUrl: text("image_url"),
    categoryPath: text("category_path").array(),
    variationAttributes: jsonb("variation_attributes").$type<Record<string, string>>(),
    sizeText: text("size_text"),
    provider: text("provider").notNull(),
    isSimulated: boolean("is_simulated").notNull().default(false),
    status: listingStatus("status").notNull().default("active"),
    // Latest known state (denormalized from the newest observation for fast tables).
    currency: text("currency"),
    currentPriceMinor: integer("current_price_minor"),
    currentPriceBasis: priceBasis("current_price_basis"),
    listPriceMinor: integer("list_price_minor"),
    availability: availability("availability").notNull().default("unknown"),
    buyBoxSellerId: uuid("buy_box_seller_id").references(() => sellers.id, { onDelete: "set null" }),
    buyBoxIsAmazon: boolean("buy_box_is_amazon"),
    lastObservedAt: ts("last_observed_at"),
    lastPriceChangeAt: ts("last_price_change_at"),
    /**
     * Provenance of the current price: the observation source it came from (e.g. "user-capture")
     * and whether that observation was simulated. Null on rows written before captures existed,
     * where the listing-level `isSimulated` applies.
     */
    currentSource: observationSource("current_source"),
    currentIsSimulated: boolean("current_is_simulated"),
    /** The provider's own "data last updated" timestamp. */
    providerUpdatedAt: ts("provider_updated_at"),
    // Monitoring state.
    checkIntervalMinutes: integer("check_interval_minutes"),
    priority: integer("priority").notNull().default(0),
    nextCheckAt: ts("next_check_at"),
    lastRequestedAt: ts("last_requested_at"),
    lastSuccessAt: ts("last_success_at"),
    lastFailureAt: ts("last_failure_at"),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("listings_mp_asin_uq").on(t.marketplace, t.asin),
    index("listings_due_idx").on(t.nextCheckAt).where(sql`${t.checkIntervalMinutes} is not null`),
    index("listings_parent_idx").on(t.marketplace, t.parentAsin),
  ],
);

/**
 * A captured price point. `observedAt` is when the provider says the value was
 * true; `capturedAt` when Aisle stored it; `requestedAt` when Aisle asked.
 */
export const priceObservations = pgTable(
  "price_observations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    source: observationSource("source").notNull().default("poll"),
    observedAt: ts("observed_at").notNull(),
    capturedAt: ts("captured_at").notNull().defaultNow(),
    requestedAt: ts("requested_at"),
    providerUpdatedAt: ts("provider_updated_at"),
    currency: text("currency").notNull(),
    /** Featured price used for analytics; see `priceBasis` for which offer it is. */
    priceMinor: integer("price_minor"),
    priceBasis: priceBasis("price_basis").notNull().default("none"),
    amazonPriceMinor: integer("amazon_price_minor"),
    lowestNewPriceMinor: integer("lowest_new_price_minor"),
    listPriceMinor: integer("list_price_minor"),
    dealPriceMinor: integer("deal_price_minor"),
    primeExclusivePriceMinor: integer("prime_exclusive_price_minor"),
    shippingMinor: integer("shipping_minor"),
    availability: availability("availability").notNull().default("unknown"),
    sellerId: uuid("seller_id").references(() => sellers.id, { onDelete: "set null" }),
    sellerIsAmazon: boolean("seller_is_amazon"),
    isSimulated: boolean("is_simulated").notNull().default(false),
    providerRequestId: uuid("provider_request_id"),
  },
  (t) => [
    uniqueIndex("obs_listing_time_provider_uq").on(t.listingId, t.observedAt, t.provider),
    index("obs_listing_time_idx").on(t.listingId, t.observedAt.desc()),
    index("obs_captured_idx").on(t.capturedAt),
  ],
);

/** Latest offer snapshot per listing (replaced on each offers refresh). */
export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    sellerId: uuid("seller_id").references(() => sellers.id, { onDelete: "set null" }),
    sellerName: text("seller_name"),
    isAmazon: boolean("is_amazon"),
    condition: text("condition").notNull().default("new"),
    priceMinor: integer("price_minor"),
    shippingMinor: integer("shipping_minor"),
    currency: text("currency").notNull(),
    isBuyBox: boolean("is_buy_box"),
    isPrime: boolean("is_prime"),
    isFba: boolean("is_fba"),
    provider: text("provider").notNull(),
    isSimulated: boolean("is_simulated").notNull().default(false),
    capturedAt: ts("captured_at").notNull().defaultNow(),
  },
  (t) => [index("offers_listing_idx").on(t.listingId)],
);

// ─── Workspace catalog ──────────────────────────────────────────────────────

/** A conceptual product (e.g. "Plant Protein") — not itself purchasable. */
export const productFamilies = pgTable(
  "product_families",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    marketplace: text("marketplace").notNull(),
    /** parent ASIN when Amazon groups variations, else the imported ASIN. */
    familyKey: text("family_key").notNull(),
    parentAsin: text("parent_asin"),
    title: text("title").notNull(),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    imageUrl: text("image_url"),
    variationDimensions: text("variation_dimensions").array().notNull().default(sql`'{}'::text[]`),
    discoveryStatus: discoveryStatus("discovery_status").notNull().default("single"),
    discoveredCount: integer("discovered_count").notNull().default(1),
    provider: text("provider").notNull(),
    isSimulated: boolean("is_simulated").notNull().default(false),
    favorite: boolean("favorite").notNull().default(false),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("families_ws_mp_key_uq").on(t.workspaceId, t.marketplace, t.familyKey),
    index("families_ws_brand_idx").on(t.workspaceId, t.brandId),
  ],
);

/** A workspace's view of one purchasable variation (wraps a shared listing). */
export const variants = pgTable(
  "variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => productFamilies.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    tracked: boolean("tracked").notNull().default(true),
    hidden: boolean("hidden").notNull().default(false),
    /** null = paused. */
    intervalMinutes: integer("interval_minutes").default(60),
    priority: boolean("priority").notNull().default(false),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("variants_ws_listing_uq").on(t.workspaceId, t.listingId),
    index("variants_family_idx").on(t.familyId),
    index("variants_listing_idx").on(t.listingId),
  ],
);

/** Structured quantity for a variant, one row per dimension (mass + servings, etc.). */
export const variantQuantities = pgTable(
  "variant_quantities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    dimension: dimension("dimension").notNull(),
    packCount: integer("pack_count").notNull().default(1),
    unitAmount: numeric("unit_amount", { precision: 14, scale: 4 }).notNull(),
    unit: text("unit").notNull(),
    totalMilli: bigint("total_milli", { mode: "number" }).notNull(),
    countNoun: text("count_noun"),
    sourceText: text("source_text"),
    matchedText: text("matched_text"),
    confidence: quantityConfidence("confidence").notNull().default("parsed"),
    updatedBy: text("updated_by"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("vq_variant_dim_uq").on(t.variantId, t.dimension)],
);

// ─── Comparisons ────────────────────────────────────────────────────────────

export const comparisonGroups = pgTable(
  "comparison_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    marketplace: text("marketplace"),
    basis: text("basis").notNull().default("per_100g"),
    referenceBrandId: uuid("reference_brand_id").references(() => brands.id, { onDelete: "set null" }),
    standardQuantityMilli: bigint("standard_quantity_milli", { mode: "number" }),
    createdBy: text("created_by"),
    /** Set for groups Aisle maintains itself (e.g. "reference_market"); null for user-built comparisons. */
    managedBy: text("managed_by"),
    /** Stable cohort key within a managed set: marketplace + category + normalization basis. */
    managedCohort: text("managed_cohort"),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("groups_ws_idx").on(t.workspaceId),
    uniqueIndex("groups_ws_managed_uq").on(t.workspaceId, t.managedBy, t.managedCohort).where(sql`${t.managedBy} is not null`),
  ],
);

export const comparisonItems = pgTable(
  "comparison_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => comparisonGroups.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    role: itemRole("role").notNull().default("competitor"),
    status: itemStatus("status").notNull().default("confirmed"),
    position: integer("position").notNull().default(0),
    note: text("note"),
    addedAt: createdAt(),
  },
  (t) => [uniqueIndex("items_group_variant_uq").on(t.groupId, t.variantId)],
);

// ─── Monitoring & provider accounting ──────────────────────────────────────

export const monitoringJobs = pgTable(
  "monitoring_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: jobKind("kind").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    provider: text("provider").notNull(),
    marketplace: text("marketplace").notNull(),
    listingIds: uuid("listing_ids").array().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    requestedBy: text("requested_by"),
    attempts: integer("attempts").notNull().default(0),
    scheduledFor: ts("scheduled_for").notNull().defaultNow(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    observationsWritten: integer("observations_written").notNull().default(0),
    tokensUsed: integer("tokens_used").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("jobs_idem_uq").on(t.idempotencyKey), index("jobs_created_idx").on(t.createdAt.desc())],
);

export const providerRequests = pgTable(
  "provider_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    marketplace: text("marketplace"),
    itemCount: integer("item_count").notNull().default(0),
    status: requestStatus("status").notNull(),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms"),
    tokensConsumed: integer("tokens_consumed"),
    tokensLeft: integer("tokens_left"),
    error: text("error"),
    jobId: uuid("job_id"),
    createdAt: createdAt(),
  },
  (t) => [index("preq_created_idx").on(t.createdAt.desc()), index("preq_provider_idx").on(t.provider, t.createdAt)],
);

export const providerQuotas = pgTable("provider_quotas", {
  provider: text("provider").primaryKey(),
  tokensLeft: integer("tokens_left"),
  refillRate: integer("refill_rate"),
  refillInMs: integer("refill_in_ms"),
  monthKey: text("month_key").notNull(),
  tokensUsedMonth: integer("tokens_used_month").notNull().default(0),
  requestsMonth: integer("requests_month").notNull().default(0),
  budgetTokensMonth: integer("budget_tokens_month"),
  pausedUntil: ts("paused_until"),
  updatedAt: updatedAt(),
});

export const fxRates = pgTable(
  "fx_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),
    provider: text("provider").notNull(),
    asOf: ts("as_of").notNull(),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fx_pair_asof_uq").on(t.base, t.quote, t.asOf)],
);

// ─── Alerts & notifications ─────────────────────────────────────────────────

export interface AlertParams {
  thresholdMinor?: number;
  pct?: number;
  gapPct?: number;
  hours?: number;
  failures?: number;
  windowDays?: number;
}

export interface QuietHours {
  start: string; // "22:00"
  end: string; // "07:00"
}

export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text("created_by"),
    name: text("name").notNull(),
    type: alertType("type").notNull(),
    variantId: uuid("variant_id").references(() => variants.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => comparisonGroups.id, { onDelete: "cascade" }),
    params: jsonb("params").$type<AlertParams>().notNull().default({}),
    frequency: alertFrequency("frequency").notNull().default("instant"),
    channels: text("channels").array().notNull().default(sql`'{in_app}'::text[]`),
    cooldownMinutes: integer("cooldown_minutes").notNull().default(360),
    quietHours: jsonb("quiet_hours").$type<QuietHours | null>(),
    paused: boolean("paused").notNull().default(false),
    /** Idempotency key for rules Aisle creates itself (e.g. the Protect My Brand pack); null for user rules. */
    managedKey: text("managed_key"),
    /** Evaluation memory for transition rules (e.g. the last observed price leader). */
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
    lastEvaluatedAt: ts("last_evaluated_at"),
    lastTriggeredAt: ts("last_triggered_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rules_ws_idx").on(t.workspaceId), uniqueIndex("rules_ws_managed_uq").on(t.workspaceId, t.managedKey).where(sql`${t.managedKey} is not null`)],
);

export const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => alertRules.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => variants.id, { onDelete: "set null" }),
    headline: text("headline").notNull(),
    detail: text("detail"),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text("dedupe_key").notNull(),
    isSimulated: boolean("is_simulated").notNull().default(false),
    isTest: boolean("is_test").notNull().default(false),
    deliveredChannels: text("delivered_channels").array().notNull().default(sql`'{}'::text[]`),
    digestSentAt: ts("digest_sent_at"),
    firedAt: ts("fired_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("events_rule_dedupe_uq").on(t.ruleId, t.dedupeKey), index("events_ws_time_idx").on(t.workspaceId, t.firedAt.desc())],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    alertEventId: uuid("alert_event_id").references(() => alertEvents.id, { onDelete: "cascade" }),
    isSimulated: boolean("is_simulated").notNull().default(false),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notif_ws_time_idx").on(t.workspaceId, t.createdAt.desc())],
);

/**
 * One outbound message to one recipient (email today). Every send attempt is
 * recorded so the UI can show honest delivery status; `idempotencyKey` is
 * unique and is also passed to the email provider, so retries never duplicate.
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    channel: text("channel").notNull().default("email"),
    kind: text("kind").notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    alertEventId: uuid("alert_event_id").references(() => alertEvents.id, { onDelete: "set null" }),
    briefingId: uuid("briefing_id"),
    status: deliveryStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(4),
    nextAttemptAt: ts("next_attempt_at"),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<{ text: string; html: string }>().notNull(),
    isTest: boolean("is_test").notNull().default(false),
    isSimulated: boolean("is_simulated").notNull().default(false),
    sentAt: ts("sent_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("deliveries_idem_uq").on(t.idempotencyKey),
    index("deliveries_due_idx").on(t.status, t.nextAttemptAt),
    index("deliveries_ws_time_idx").on(t.workspaceId, t.createdAt.desc()),
  ],
);

/** A stored weekly briefing (previous Monday–Sunday in the workspace time zone). One per workspace and week. */
export const briefings = pgTable(
  "briefings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Local calendar dates (YYYY-MM-DD) in `timeZone`. */
    weekStart: text("week_start").notNull(),
    weekEnd: text("week_end").notNull(),
    timeZone: text("time_zone").notNull(),
    periodStart: ts("period_start").notNull(),
    periodEnd: ts("period_end").notNull(),
    referenceBrandId: uuid("reference_brand_id").references(() => brands.id, { onDelete: "set null" }),
    referenceBrandName: text("reference_brand_name"),
    content: jsonb("content").$type<BriefingContent>().notNull(),
    containsSimulated: boolean("contains_simulated").notNull().default(false),
    version: integer("version").notNull().default(1),
    generatedBy: text("generated_by"),
    generatedAt: ts("generated_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("briefings_ws_week_uq").on(t.workspaceId, t.weekStart)],
);

// ─── Bulk import jobs ───────────────────────────────────────────────────────

export interface ImportJobOptions {
  variantPolicy: "pasted_only" | "all_variants";
  intervalMinutes: 60 | 180 | 360 | 720 | 1440 | null;
  groupId: string | null;
  defaultMarketplace: string;
}

/** A queued bulk import. Items are processed in chunks of 25 by the web app (while open) or the worker. */
export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    status: importJobStatus("status").notNull().default("queued"),
    total: integer("total").notNull().default(0),
    options: jsonb("options").$type<ImportJobOptions>().notNull(),
    /** Lease held by whichever process is running a chunk; expired leases are taken over (resume after a crash or closed tab). */
    leaseUntil: ts("lease_until"),
    lastError: text("last_error"),
    isSimulated: boolean("is_simulated").notNull().default(false),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("import_jobs_ws_idx").on(t.workspaceId, t.createdAt.desc()), index("import_jobs_status_idx").on(t.status)],
);

export const importJobItems = pgTable(
  "import_job_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    input: text("input").notNull(),
    marketplace: text("marketplace"),
    asin: text("asin"),
    status: importItemStatus("status").notNull().default("pending"),
    familyId: uuid("family_id").references(() => productFamilies.id, { onDelete: "set null" }),
    variantIds: uuid("variant_ids").array().notNull().default(sql`'{}'::uuid[]`),
    newVariants: integer("new_variants").notNull().default(0),
    errorCode: text("error_code"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("import_items_job_pos_uq").on(t.jobId, t.position), index("import_items_job_status_idx").on(t.jobId, t.status)],
);

// ─── User-driven price capture (bookmarklet) ────────────────────────────────

/**
 * Personal API tokens for the price-capture bookmarklet. Only a SHA-256 hash is
 * stored; the token itself is shown once. One active token per user and workspace.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull().default("capture"),
    tokenHash: text("token_hash").notNull(),
    /** First characters of the token, for recognising it in the UI. Not enough to use it. */
    prefix: text("prefix").notNull(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_tokens_hash_uq").on(t.tokenHash), index("api_tokens_user_idx").on(t.userId, t.workspaceId)],
);

/** Every capture received from the bookmarklet, recorded or not (untracked ASINs, duplicates). */
export const priceCaptures = pgTable(
  "price_captures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    variantId: uuid("variant_id").references(() => variants.id, { onDelete: "set null" }),
    listingId: uuid("listing_id").references(() => listings.id, { onDelete: "set null" }),
    observationId: bigint("observation_id", { mode: "number" }),
    status: text("status").notNull(),
    asin: text("asin").notNull(),
    marketplace: text("marketplace").notNull(),
    title: text("title"),
    priceMinor: integer("price_minor"),
    currency: text("currency").notNull(),
    isDeal: boolean("is_deal").notNull().default(false),
    selector: text("selector"),
    variantLabel: text("variant_label"),
    availabilityText: text("availability_text"),
    availability: availability("availability").notNull().default("unknown"),
    url: text("url").notNull(),
    /** When the page was read, per the browser; validated against the server clock. */
    capturedAt: ts("captured_at").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [index("captures_ws_time_idx").on(t.workspaceId, t.receivedAt.desc()), index("captures_listing_idx").on(t.listingId, t.capturedAt.desc())],
);

// ─── Views, reports, activity ───────────────────────────────────────────────

export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    name: text("name").notNull(),
    state: jsonb("state").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("views_ws_scope_idx").on(t.workspaceId, t.scope)],
);

export const reportDefinitions = pgTable("report_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  createdBy: text("created_by"),
  name: text("name").notNull(),
  type: text("type").notNull(),
  params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
  format: reportFormat("format").notNull().default("xlsx"),
  schedule: text("schedule").notNull().default("none"),
  lastRunAt: ts("last_run_at"),
  createdAt: createdAt(),
});

export const reportRuns = pgTable(
  "report_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    definitionId: uuid("definition_id").references(() => reportDefinitions.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    format: reportFormat("format").notNull(),
    status: text("status").notNull().default("succeeded"),
    rowCount: integer("row_count").notNull().default(0),
    dataAsOf: ts("data_as_of"),
    containsSimulated: boolean("contains_simulated").notNull().default(false),
    error: text("error"),
    requestedBy: text("requested_by"),
    createdAt: createdAt(),
  },
  (t) => [index("runs_ws_idx").on(t.workspaceId, t.createdAt.desc())],
);

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id"),
    kind: text("kind").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    isSimulated: boolean("is_simulated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("activity_ws_time_idx").on(t.workspaceId, t.createdAt.desc())],
);

export type Listing = typeof listings.$inferSelect;
export type PriceObservation = typeof priceObservations.$inferSelect;
export type Variant = typeof variants.$inferSelect;
export type ProductFamily = typeof productFamilies.$inferSelect;
export type ComparisonGroup = typeof comparisonGroups.$inferSelect;
export type AlertRule = typeof alertRules.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Brand = typeof brands.$inferSelect;
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type Briefing = typeof briefings.$inferSelect;
export type ImportJob = typeof importJobs.$inferSelect;
export type ImportJobItem = typeof importJobItems.$inferSelect;
export type PriceCapture = typeof priceCaptures.$inferSelect;

/** Short-lived key/value cache used when Redis isn't configured (e.g. serverless free tiers). */
export const cacheEntries = pgTable("cache_entries", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
});
