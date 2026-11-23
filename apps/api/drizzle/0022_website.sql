ALTER TABLE "tenants" ADD COLUMN "website_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "website_subscription_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "website_cancels_at" timestamp with time zone;