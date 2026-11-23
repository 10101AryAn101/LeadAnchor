CREATE TABLE "handoff_offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"handoff_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"from_business" text NOT NULL,
	"trade" text NOT NULL,
	"title" text NOT NULL,
	"area" text NOT NULL,
	"urgency" text NOT NULL,
	"note" text,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"lead_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_handoffs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"trade" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'offered' NOT NULL,
	"return_stage" text NOT NULL,
	"offered_to" integer NOT NULL,
	"partner_tenant_id" uuid,
	"partner_lead_id" uuid,
	"shared_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"customer_token_hash" text,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_handoffs_customer_token_hash_unique" UNIQUE("customer_token_hash")
);
--> statement-breakpoint
CREATE TABLE "network_members" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"trades" text[] NOT NULL,
	"terms_version" text NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"terms_accepted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_conversions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"counted" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_credits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"amount_cents" integer,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "referral_code" text DEFAULT upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)) NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "referred_by_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "handoff_offers" ADD CONSTRAINT "handoff_offers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_offers" ADD CONSTRAINT "handoff_offers_handoff_id_lead_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."lead_handoffs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_offers" ADD CONSTRAINT "handoff_offers_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_handoffs" ADD CONSTRAINT "lead_handoffs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_handoffs" ADD CONSTRAINT "lead_handoffs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_handoffs" ADD CONSTRAINT "lead_handoffs_partner_tenant_id_tenants_id_fk" FOREIGN KEY ("partner_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_handoffs" ADD CONSTRAINT "lead_handoffs_partner_lead_id_leads_id_fk" FOREIGN KEY ("partner_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_members" ADD CONSTRAINT "network_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_conversions" ADD CONSTRAINT "referral_conversions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_credits" ADD CONSTRAINT "referral_credits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "handoff_offers_uq" ON "handoff_offers" USING btree ("handoff_id","tenant_id");--> statement-breakpoint
CREATE INDEX "handoff_offers_tenant_idx" ON "handoff_offers" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "lead_handoffs_lead_idx" ON "lead_handoffs" USING btree ("tenant_id","lead_id");--> statement-breakpoint
CREATE INDEX "lead_handoffs_open_idx" ON "lead_handoffs" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_conversions_uq" ON "referral_conversions" USING btree ("kind","source_id");--> statement-breakpoint
CREATE INDEX "referral_conversions_tenant_idx" ON "referral_conversions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "referral_credits_tenant_idx" ON "referral_credits" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_referred_by_tenant_id_tenants_id_fk" FOREIGN KEY ("referred_by_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_referral_code_unique" UNIQUE("referral_code");