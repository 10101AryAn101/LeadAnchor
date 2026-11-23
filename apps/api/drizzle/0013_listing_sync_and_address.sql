ALTER TABLE "tenants" ADD COLUMN "street_address" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "listing_connections" ADD COLUMN "sync_fields" jsonb DEFAULT '{"hours":true,"phone":true,"website":true,"bookingLink":true,"address":true}'::jsonb NOT NULL;