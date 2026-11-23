CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"customer_id" uuid,
	"email" text NOT NULL,
	"name" text,
	"status" text NOT NULL,
	"skip_reason" text,
	"basis" text NOT NULL,
	"message_id" uuid,
	"token_hash" text,
	"sent_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"clicks" integer DEFAULT 0 NOT NULL,
	"booked_at" timestamp with time zone,
	"lead_id" uuid,
	"unsubscribed_at" timestamp with time zone,
	"complained_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_recipients_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"name" text NOT NULL,
	"audience" jsonb NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"offer" text,
	"offer_ends_on" date,
	"service_id" uuid,
	"trigger" jsonb,
	"trigger_key" text,
	"suggested_until" timestamp with time zone,
	"scheduled_for" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"reply_to" text,
	"sent_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "html" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reply_to" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "feedback" text;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_email_uq" ON "campaign_recipients" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE INDEX "campaign_recipients_email_idx" ON "campaign_recipients" USING btree ("tenant_id","email","created_at");--> statement-breakpoint
CREATE INDEX "campaign_recipients_message_idx" ON "campaign_recipients" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "campaigns_tenant_idx" ON "campaigns" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_trigger_uq" ON "campaigns" USING btree ("tenant_id","trigger_key");