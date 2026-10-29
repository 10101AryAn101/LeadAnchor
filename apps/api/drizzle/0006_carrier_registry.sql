ALTER TABLE "carrier_registrations" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "carrier_registrations" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "carrier_registrations" ADD COLUMN "otp_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "carrier_registrations" ADD COLUMN "otp_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "carrier_registrations" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "carrier_registrations" ADD COLUMN "id_purged_at" timestamp with time zone;