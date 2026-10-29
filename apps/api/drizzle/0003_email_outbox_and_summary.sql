ALTER TABLE "tenants" ADD COLUMN "value_proof_last_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "subject" text;