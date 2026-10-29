CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_numbers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"e164" text NOT NULL,
	"provider" text NOT NULL,
	"provider_number_id" text,
	"purpose" text DEFAULT 'tracking' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"trade" text NOT NULL,
	"track" text NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"owner_name" text,
	"owner_cell_e164" text,
	"city" text,
	"state" text,
	"website" text,
	"license_number" text,
	"insurance_carrier" text,
	"years_in_business" integer,
	"avg_job_value_cents" integer DEFAULT 25000 NOT NULL,
	"ring_timeout_secs" integer DEFAULT 18 NOT NULL,
	"dispatcher_enabled" boolean DEFAULT true NOT NULL,
	"value_proof_frequency" text DEFAULT 'weekly' NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone_e164" text,
	"name" text,
	"email" text,
	"address" text,
	"notes" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_contact_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"service_category" text,
	"urgency" text DEFAULT 'normal' NOT NULL,
	"value_cents" integer,
	"estimated_value_cents" integer,
	"needs_callback" boolean DEFAULT false NOT NULL,
	"intake_status" text DEFAULT 'none' NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"lost_reason" text,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"won_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_mins" integer,
	"price_cents" integer,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_session_id" text NOT NULL,
	"provider_call_id" text NOT NULL,
	"owner_leg_id" text,
	"from_e164" text NOT NULL,
	"to_e164" text NOT NULL,
	"customer_id" uuid,
	"lead_id" uuid,
	"caller_type" text,
	"state" text DEFAULT 'ringing' NOT NULL,
	"outcome" text DEFAULT 'in_progress' NOT NULL,
	"transcript" text,
	"consent_captured_at" timestamp with time zone,
	"recording_url" text,
	"hangup_cause" text,
	"duration_secs" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"submission" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"thumb_key" text,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"sha256" text NOT NULL,
	"ai_status" text DEFAULT 'pending' NOT NULL,
	"ai_tags" jsonb,
	"ai_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid,
	"lead_id" uuid,
	"direction" text NOT NULL,
	"channel" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text NOT NULL,
	"to_address" text NOT NULL,
	"from_address" text NOT NULL,
	"body" text NOT NULL,
	"blocked_reason" text,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"policy" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"lead_id" uuid,
	"push_status" text DEFAULT 'in_app' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_registrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"path" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"display_name" text NOT NULL,
	"tax_id_encrypted" text,
	"tax_id_last4" text,
	"date_of_birth_encrypted" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_brand_id" text,
	"provider_campaign_id" text,
	"status_reason" text,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"type" text NOT NULL,
	"action" text NOT NULL,
	"source" text NOT NULL,
	"text_version" text NOT NULL,
	"evidence" text,
	"ip_address" text,
	"granted_to" text NOT NULL,
	"call_id" uuid,
	"prev_hash" text,
	"hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"tenant_id" uuid,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_requests" ADD CONSTRAINT "intake_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_requests" ADD CONSTRAINT "intake_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_requests" ADD CONSTRAINT "intake_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_registrations" ADD CONSTRAINT "carrier_registrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_ledger" ADD CONSTRAINT "consent_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_uq" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "phone_numbers_e164_uq" ON "phone_numbers" USING btree ("e164");--> statement-breakpoint
CREATE INDEX "phone_numbers_tenant_idx" ON "phone_numbers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_phone_uq" ON "customers" USING btree ("tenant_id","phone_e164");--> statement-breakpoint
CREATE INDEX "lead_events_lead_idx" ON "lead_events" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_board_idx" ON "leads" USING btree ("tenant_id","stage","position");--> statement-breakpoint
CREATE INDEX "leads_customer_idx" ON "leads" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "leads_created_idx" ON "leads" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "services_tenant_idx" ON "services" USING btree ("tenant_id","sort_order");--> statement-breakpoint
CREATE INDEX "call_events_call_idx" ON "call_events" USING btree ("call_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_provider_session_uq" ON "calls" USING btree ("provider","provider_session_id");--> statement-breakpoint
CREATE INDEX "calls_provider_call_idx" ON "calls" USING btree ("provider_call_id");--> statement-breakpoint
CREATE INDEX "calls_tenant_started_idx" ON "calls" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "intake_requests_token_uq" ON "intake_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "intake_requests_lead_idx" ON "intake_requests" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "media_assets_lead_idx" ON "media_assets" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "messages_customer_idx" ON "messages" USING btree ("tenant_id","customer_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_lead_idx" ON "messages" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "messages_to_idx" ON "messages" USING btree ("to_address","created_at");--> statement-breakpoint
CREATE INDEX "notifications_tenant_idx" ON "notifications" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_registrations_tenant_uq" ON "carrier_registrations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "consent_ledger_lookup_idx" ON "consent_ledger" USING btree ("tenant_id","phone_e164","type","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_inbox_event_uq" ON "webhook_inbox" USING btree ("provider","event_id");