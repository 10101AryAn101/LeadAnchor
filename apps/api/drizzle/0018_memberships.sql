CREATE TABLE "membership_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"provider_invoice_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"failure" text,
	"work_done_at" timestamp with time zone,
	"lead_id" uuid,
	"receipt_sent_at" timestamp with time zone,
	"noticed_attempts" integer DEFAULT 0 NOT NULL,
	"owner_alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_cents" integer NOT NULL,
	"interval" text NOT NULL,
	"includes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"work_service_id" uuid,
	"work_cadence" jsonb NOT NULL,
	"welcome_message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"link_token" text NOT NULL,
	"provider" text,
	"provider_product_id" text,
	"provider_price_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plans_link_token_unique" UNIQUE("link_token")
);
--> statement-breakpoint
CREATE TABLE "plan_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"price_cents" integer NOT NULL,
	"interval" text NOT NULL,
	"provider_price_id" text,
	"email" text NOT NULL,
	"provider" text,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"provider_checkout_id" text,
	"card_brand" text,
	"card_last4" text,
	"started_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"canceled_by" text,
	"consent_text" text NOT NULL,
	"consent_version" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"consent_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "membership_invoices" ADD CONSTRAINT "membership_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_invoices" ADD CONSTRAINT "membership_invoices_membership_id_plan_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."plan_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_invoices" ADD CONSTRAINT "membership_invoices_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_work_service_id_services_id_fk" FOREIGN KEY ("work_service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_memberships" ADD CONSTRAINT "plan_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_memberships" ADD CONSTRAINT "plan_memberships_plan_id_membership_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_memberships" ADD CONSTRAINT "plan_memberships_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_invoices_provider_uq" ON "membership_invoices" USING btree ("tenant_id","provider_invoice_id");--> statement-breakpoint
CREATE INDEX "membership_invoices_membership_idx" ON "membership_invoices" USING btree ("membership_id","created_at");--> statement-breakpoint
CREATE INDEX "membership_plans_tenant_idx" ON "membership_plans" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "plan_memberships_tenant_idx" ON "plan_memberships" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "plan_memberships_customer_idx" ON "plan_memberships" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_memberships_subscription_uq" ON "plan_memberships" USING btree ("provider","provider_subscription_id");