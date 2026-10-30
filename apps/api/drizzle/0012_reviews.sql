CREATE TABLE "email_opt_outs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account" text NOT NULL,
	"location_name" text,
	"credentials_sealed" text,
	"rating" double precision,
	"review_count" integer DEFAULT 0 NOT NULL,
	"review_url" text,
	"listing_url" text,
	"last_synced_at" timestamp with time zone,
	"last_pushed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"text" text NOT NULL,
	"status" text NOT NULL,
	"external_id" text,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"outcome" text DEFAULT 'scheduled' NOT NULL,
	"detail" text,
	"send_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"message_id" uuid,
	"token_hash" text NOT NULL,
	"token_sealed" text NOT NULL,
	"feedback_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"reviewer_name" text NOT NULL,
	"rating" integer NOT NULL,
	"text" text,
	"published_at" timestamp with time zone NOT NULL,
	"reply_text" text,
	"reply_posted_at" timestamp with time zone,
	"draft_text" text,
	"reply_status" text DEFAULT 'needs_reply' NOT NULL,
	"reply_error" text,
	"reply_approved_by" text,
	"show_on_profile" boolean DEFAULT false NOT NULL,
	"customer_id" uuid,
	"lead_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "review_reply_tone" text DEFAULT 'warm' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_opt_outs" ADD CONSTRAINT "email_opt_outs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_connections" ADD CONSTRAINT "listing_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_posts" ADD CONSTRAINT "listing_posts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_opt_outs_uq" ON "email_opt_outs" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_connections_tenant_uq" ON "listing_connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "listing_posts_tenant_idx" ON "listing_posts" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_lead_uq" ON "review_requests" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_token_uq" ON "review_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "review_requests_due_idx" ON "review_requests" USING btree ("outcome","send_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_external_uq" ON "reviews" USING btree ("tenant_id","external_id");--> statement-breakpoint
CREATE INDEX "reviews_tenant_time_idx" ON "reviews" USING btree ("tenant_id","published_at");