ALTER TABLE "leads" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "leads_tags_idx" ON "leads" USING gin ("tags");