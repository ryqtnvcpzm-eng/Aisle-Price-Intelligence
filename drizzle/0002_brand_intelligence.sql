CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'sending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."import_item_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."import_job_status" AS ENUM('queued', 'running', 'paused', 'completed', 'cancelled', 'failed');--> statement-breakpoint
ALTER TYPE "public"."alert_type" ADD VALUE 'price_leadership_change';--> statement-breakpoint
ALTER TYPE "public"."alert_type" ADD VALUE 'reference_out_of_stock';--> statement-breakpoint
ALTER TYPE "public"."alert_type" ADD VALUE 'rival_drop_5pct';--> statement-breakpoint
CREATE TABLE "briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"week_start" text NOT NULL,
	"week_end" text NOT NULL,
	"time_zone" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"reference_brand_id" uuid,
	"reference_brand_name" text,
	"content" jsonb NOT NULL,
	"contains_simulated" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"generated_by" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_job_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"input" text NOT NULL,
	"marketplace" text,
	"asin" text,
	"status" "import_item_status" DEFAULT 'pending' NOT NULL,
	"family_id" uuid,
	"variant_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"new_variants" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" text,
	"status" "import_job_status" DEFAULT 'queued' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"options" jsonb NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text,
	"channel" text DEFAULT 'email' NOT NULL,
	"kind" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"alert_event_id" uuid,
	"briefing_id" uuid,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 4 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"provider_message_id" text,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD COLUMN "managed_key" text;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD COLUMN "state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "comparison_groups" ADD COLUMN "managed_by" text;--> statement-breakpoint
ALTER TABLE "comparison_groups" ADD COLUMN "managed_cohort" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_reference_brand_id_brands_id_fk" FOREIGN KEY ("reference_brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_items" ADD CONSTRAINT "import_job_items_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_items" ADD CONSTRAINT "import_job_items_family_id_product_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."product_families"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_alert_event_id_alert_events_id_fk" FOREIGN KEY ("alert_event_id") REFERENCES "public"."alert_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "briefings_ws_week_uq" ON "briefings" USING btree ("workspace_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "import_items_job_pos_uq" ON "import_job_items" USING btree ("job_id","position");--> statement-breakpoint
CREATE INDEX "import_items_job_status_idx" ON "import_job_items" USING btree ("job_id","status");--> statement-breakpoint
CREATE INDEX "import_jobs_ws_idx" ON "import_jobs" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_jobs_status_idx" ON "import_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_idem_uq" ON "notification_deliveries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "deliveries_due_idx" ON "notification_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "deliveries_ws_time_idx" ON "notification_deliveries" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "rules_ws_managed_uq" ON "alert_rules" USING btree ("workspace_id","managed_key") WHERE "alert_rules"."managed_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_ws_reference_uq" ON "brands" USING btree ("workspace_id") WHERE "brands"."is_reference";--> statement-breakpoint
CREATE UNIQUE INDEX "groups_ws_managed_uq" ON "comparison_groups" USING btree ("workspace_id","managed_by","managed_cohort") WHERE "comparison_groups"."managed_by" is not null;