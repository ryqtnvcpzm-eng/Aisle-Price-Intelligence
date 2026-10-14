ALTER TYPE "public"."observation_source" ADD VALUE 'user-capture';--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text DEFAULT 'capture' NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text,
	"variant_id" uuid,
	"listing_id" uuid,
	"observation_id" bigint,
	"status" text NOT NULL,
	"asin" text NOT NULL,
	"marketplace" text NOT NULL,
	"title" text,
	"price_minor" integer,
	"currency" text NOT NULL,
	"is_deal" boolean DEFAULT false NOT NULL,
	"selector" text,
	"variant_label" text,
	"availability_text" text,
	"availability" "availability" DEFAULT 'unknown' NOT NULL,
	"url" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "current_source" "observation_source";--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "current_is_simulated" boolean;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_captures" ADD CONSTRAINT "price_captures_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_captures" ADD CONSTRAINT "price_captures_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_captures" ADD CONSTRAINT "price_captures_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_captures" ADD CONSTRAINT "price_captures_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash_uq" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "captures_ws_time_idx" ON "price_captures" USING btree ("workspace_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "captures_listing_idx" ON "price_captures" USING btree ("listing_id","captured_at" DESC NULLS LAST);