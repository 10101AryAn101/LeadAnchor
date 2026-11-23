ALTER TABLE "plan_memberships" ADD COLUMN "pending_price_cents" integer;--> statement-breakpoint
ALTER TABLE "plan_memberships" ADD COLUMN "pending_price_id" text;--> statement-breakpoint
ALTER TABLE "plan_memberships" ADD COLUMN "pending_price_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_memberships" ADD COLUMN "price_notice_at" timestamp with time zone;