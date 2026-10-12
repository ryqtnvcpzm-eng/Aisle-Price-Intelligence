CREATE TYPE "public"."alert_frequency" AS ENUM('instant', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('price_below', 'price_above', 'pct_drop', 'pct_rise', 'daily_move', 'competitor_undercut', 'gap_exceeds', 'leader_change', 'historical_low', 'out_of_stock', 'back_in_stock', 'stale_data', 'quota_exhausted', 'monitoring_failures');--> statement-breakpoint
CREATE TYPE "public"."availability" AS ENUM('in_stock', 'out_of_stock', 'limited', 'preorder', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."quantity_dimension" AS ENUM('mass', 'volume', 'count', 'serving');--> statement-breakpoint
CREATE TYPE "public"."discovery_status" AS ENUM('complete', 'partial', 'unavailable', 'single');--> statement-breakpoint
CREATE TYPE "public"."comparison_role" AS ENUM('reference', 'competitor');--> statement-breakpoint
CREATE TYPE "public"."comparison_item_status" AS ENUM('confirmed', 'suggested');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('scheduled', 'manual', 'import', 'backfill');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'partial', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'unavailable', 'discontinued', 'not_found', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'analyst', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."observation_source" AS ENUM('poll', 'import', 'backfill', 'manual');--> statement-breakpoint
CREATE TYPE "public"."price_basis" AS ENUM('buy_box', 'amazon', 'lowest_new', 'none');--> statement-breakpoint
CREATE TYPE "public"."quantity_confidence" AS ENUM('provider', 'parsed', 'manual', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."report_format" AS ENUM('csv', 'xlsx', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."provider_request_status" AS ENUM('ok', 'error', 'rate_limited', 'quota_exhausted', 'auth_error', 'timeout');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"actor_user_id" text,
	"kind" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"variant_id" uuid,
	"headline" text NOT NULL,
	"detail" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"delivered_channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"digest_sent_at" timestamp with time zone,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"type" "alert_type" NOT NULL,
	"variant_id" uuid,
	"group_id" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"frequency" "alert_frequency" DEFAULT 'instant' NOT NULL,
	"channels" text[] DEFAULT '{in_app}'::text[] NOT NULL,
	"cooldown_minutes" integer DEFAULT 360 NOT NULL,
	"quiet_hours" jsonb,
	"paused" boolean DEFAULT false NOT NULL,
	"last_evaluated_at" timestamp with time zone,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_reference" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"marketplace" text,
	"basis" text DEFAULT 'per_100g' NOT NULL,
	"reference_brand_id" uuid,
	"standard_quantity_milli" bigint,
	"created_by" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"role" "comparison_role" DEFAULT 'competitor' NOT NULL,
	"status" "comparison_item_status" DEFAULT 'confirmed' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" numeric(20, 10) NOT NULL,
	"provider" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" text NOT NULL,
	"asin" text NOT NULL,
	"parent_asin" text,
	"title" text,
	"brand_name" text,
	"image_url" text,
	"category_path" text[],
	"variation_attributes" jsonb,
	"size_text" text,
	"provider" text NOT NULL,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"currency" text,
	"current_price_minor" integer,
	"current_price_basis" "price_basis",
	"list_price_minor" integer,
	"availability" "availability" DEFAULT 'unknown' NOT NULL,
	"buy_box_seller_id" uuid,
	"buy_box_is_amazon" boolean,
	"last_observed_at" timestamp with time zone,
	"last_price_change_at" timestamp with time zone,
	"provider_updated_at" timestamp with time zone,
	"check_interval_minutes" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"next_check_at" timestamp with time zone,
	"last_requested_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "job_kind" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"provider" text NOT NULL,
	"marketplace" text NOT NULL,
	"listing_ids" uuid[] NOT NULL,
	"idempotency_key" text NOT NULL,
	"workspace_id" uuid,
	"requested_by" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"observations_written" integer DEFAULT 0 NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"alert_event_id" uuid,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"seller_id" uuid,
	"seller_name" text,
	"is_amazon" boolean,
	"condition" text DEFAULT 'new' NOT NULL,
	"price_minor" integer,
	"shipping_minor" integer,
	"currency" text NOT NULL,
	"is_buy_box" boolean,
	"is_prime" boolean,
	"is_fba" boolean,
	"provider" text NOT NULL,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"source" "observation_source" DEFAULT 'poll' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_at" timestamp with time zone,
	"provider_updated_at" timestamp with time zone,
	"currency" text NOT NULL,
	"price_minor" integer,
	"price_basis" "price_basis" DEFAULT 'none' NOT NULL,
	"amazon_price_minor" integer,
	"lowest_new_price_minor" integer,
	"list_price_minor" integer,
	"deal_price_minor" integer,
	"prime_exclusive_price_minor" integer,
	"shipping_minor" integer,
	"availability" "availability" DEFAULT 'unknown' NOT NULL,
	"seller_id" uuid,
	"seller_is_amazon" boolean,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"provider_request_id" uuid
);
--> statement-breakpoint
CREATE TABLE "product_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"marketplace" text NOT NULL,
	"family_key" text NOT NULL,
	"parent_asin" text,
	"title" text NOT NULL,
	"brand_id" uuid,
	"category_id" uuid,
	"image_url" text,
	"variation_dimensions" text[] DEFAULT '{}'::text[] NOT NULL,
	"discovery_status" "discovery_status" DEFAULT 'single' NOT NULL,
	"discovered_count" integer DEFAULT 1 NOT NULL,
	"provider" text NOT NULL,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_quotas" (
	"provider" text PRIMARY KEY NOT NULL,
	"tokens_left" integer,
	"refill_rate" integer,
	"refill_in_ms" integer,
	"month_key" text NOT NULL,
	"tokens_used_month" integer DEFAULT 0 NOT NULL,
	"requests_month" integer DEFAULT 0 NOT NULL,
	"budget_tokens_month" integer,
	"paused_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"marketplace" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"status" "provider_request_status" NOT NULL,
	"http_status" integer,
	"duration_ms" integer,
	"tokens_consumed" integer,
	"tokens_left" integer,
	"error" text,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"format" "report_format" DEFAULT 'xlsx' NOT NULL,
	"schedule" text DEFAULT 'none' NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"definition_id" uuid,
	"type" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"format" "report_format" NOT NULL,
	"status" text DEFAULT 'succeeded' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"data_as_of" timestamp with time zone,
	"contains_simulated" boolean DEFAULT false NOT NULL,
	"error" text,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" text NOT NULL,
	"seller_id" text NOT NULL,
	"name" text,
	"is_amazon" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "variant_quantities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"dimension" "quantity_dimension" NOT NULL,
	"pack_count" integer DEFAULT 1 NOT NULL,
	"unit_amount" numeric(14, 4) NOT NULL,
	"unit" text NOT NULL,
	"total_milli" bigint NOT NULL,
	"count_noun" text,
	"source_text" text,
	"matched_text" text,
	"confidence" "quantity_confidence" DEFAULT 'parsed' NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"label" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tracked" boolean DEFAULT true NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"interval_minutes" integer DEFAULT 60,
	"priority" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'analyst' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"default_marketplace" text DEFAULT 'IN' NOT NULL,
	"default_currency" text,
	"default_basis" text DEFAULT 'per_100g' NOT NULL,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"settings" jsonb DEFAULT '{"defaultIntervalMinutes":60,"digest":"daily","emailAlerts":false,"exportIncludeMethodology":true,"significantChangePct":3}'::jsonb NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_group_id_comparison_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."comparison_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_groups" ADD CONSTRAINT "comparison_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_groups" ADD CONSTRAINT "comparison_groups_reference_brand_id_brands_id_fk" FOREIGN KEY ("reference_brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_items" ADD CONSTRAINT "comparison_items_group_id_comparison_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."comparison_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_items" ADD CONSTRAINT "comparison_items_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_buy_box_seller_id_sellers_id_fk" FOREIGN KEY ("buy_box_seller_id") REFERENCES "public"."sellers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_jobs" ADD CONSTRAINT "monitoring_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_alert_event_id_alert_events_id_fk" FOREIGN KEY ("alert_event_id") REFERENCES "public"."alert_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_families" ADD CONSTRAINT "product_families_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_families" ADD CONSTRAINT "product_families_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_families" ADD CONSTRAINT "product_families_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_definition_id_report_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."report_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_quantities" ADD CONSTRAINT "variant_quantities_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_family_id_product_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."product_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_ws_time_idx" ON "activity_logs" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "events_rule_dedupe_uq" ON "alert_events" USING btree ("rule_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "events_ws_time_idx" ON "alert_events" USING btree ("workspace_id","fired_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "rules_ws_idx" ON "alert_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_ws_slug_uq" ON "brands" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_ws_slug_uq" ON "categories" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "groups_ws_idx" ON "comparison_groups" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "items_group_variant_uq" ON "comparison_items" USING btree ("group_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_pair_asof_uq" ON "fx_rates" USING btree ("base","quote","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_mp_asin_uq" ON "listings" USING btree ("marketplace","asin");--> statement-breakpoint
CREATE INDEX "listings_due_idx" ON "listings" USING btree ("next_check_at") WHERE "listings"."check_interval_minutes" is not null;--> statement-breakpoint
CREATE INDEX "listings_parent_idx" ON "listings" USING btree ("marketplace","parent_asin");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idem_uq" ON "monitoring_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_created_idx" ON "monitoring_jobs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notif_ws_time_idx" ON "notifications" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "offers_listing_idx" ON "offers" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "obs_listing_time_provider_uq" ON "price_observations" USING btree ("listing_id","observed_at","provider");--> statement-breakpoint
CREATE INDEX "obs_listing_time_idx" ON "price_observations" USING btree ("listing_id","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "obs_captured_idx" ON "price_observations" USING btree ("captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "families_ws_mp_key_uq" ON "product_families" USING btree ("workspace_id","marketplace","family_key");--> statement-breakpoint
CREATE INDEX "families_ws_brand_idx" ON "product_families" USING btree ("workspace_id","brand_id");--> statement-breakpoint
CREATE INDEX "preq_created_idx" ON "provider_requests" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "preq_provider_idx" ON "provider_requests" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "runs_ws_idx" ON "report_runs" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "views_ws_scope_idx" ON "saved_views" USING btree ("workspace_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "sellers_mp_sid_uq" ON "sellers" USING btree ("marketplace","seller_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vq_variant_dim_uq" ON "variant_quantities" USING btree ("variant_id","dimension");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_ws_listing_uq" ON "variants" USING btree ("workspace_id","listing_id");--> statement-breakpoint
CREATE INDEX "variants_family_idx" ON "variants" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "variants_listing_idx" ON "variants" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "workspace_members" USING btree ("user_id");