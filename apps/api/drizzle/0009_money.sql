CREATE TABLE "payment_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text,
	"provider_account_id" text,
	"status" text DEFAULT 'not_connected' NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"zelle" text,
	"venmo" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"quote_id" uuid,
	"kind" text NOT NULL,
	"capture" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	"note" text,
	"token_hash" text,
	"token_sealed" text,
	"provider" text NOT NULL,
	"provider_checkout_id" text,
	"provider_payment_id" text,
	"checkout_url" text,
	"checkout_expires_at" timestamp with time zone,
	"method" text,
	"card_brand" text,
	"card_last4" text,
	"held_at" timestamp with time zone,
	"hold_expires_at" timestamp with time zone,
	"hold_warned_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"last_failure" text,
	"reported_method" text,
	"reported_at" timestamp with time zone,
	"receipt_sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"service_id" uuid,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer,
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"deposit_cents" integer,
	"deposit_capture" text DEFAULT 'hold' NOT NULL,
	"token_hash" text,
	"token_sealed" text,
	"draft_source" text NOT NULL,
	"draft_model" text,
	"draft_ms" integer,
	"draft_photos" integer DEFAULT 0 NOT NULL,
	"draft_note" text,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_revision" integer,
	"accepted_ip" text,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_tenant_uq" ON "payment_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_provider_uq" ON "payment_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_token_uq" ON "payment_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "payment_requests_lead_idx" ON "payment_requests" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_requests_status_idx" ON "payment_requests" USING btree ("status","hold_expires_at");--> statement-breakpoint
CREATE INDEX "payment_requests_checkout_idx" ON "payment_requests" USING btree ("provider_checkout_id");--> statement-breakpoint
CREATE INDEX "quote_lines_quote_idx" ON "quote_lines" USING btree ("quote_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_tenant_number_uq" ON "quotes" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_token_uq" ON "quotes" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "quotes_lead_idx" ON "quotes" USING btree ("lead_id","created_at");