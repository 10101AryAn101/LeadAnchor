ALTER TABLE "tenants" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trial_ends_at" timestamp with time zone DEFAULT now() + interval '14 days';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_customer_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_subscription_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_cancels_at" timestamp with time zone;