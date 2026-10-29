ALTER TABLE "tenants" ADD COLUMN "insurance_policy_number" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "google_profile_url" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "profile_link_in_texts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "showcase" boolean DEFAULT false NOT NULL;