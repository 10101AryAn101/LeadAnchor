ALTER TABLE "tenants" ADD COLUMN "forwarding_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "forwarding_checked_at" timestamp with time zone;