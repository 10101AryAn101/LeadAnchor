CREATE TABLE "ai_visibility_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asked" integer NOT NULL,
	"mentioned" integer NOT NULL,
	"questions" jsonb NOT NULL,
	"mismatches" jsonb NOT NULL,
	"simulated" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_discovery_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_visibility_checks" ADD CONSTRAINT "ai_visibility_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_visibility_checks_tenant_idx" ON "ai_visibility_checks" USING btree ("tenant_id","created_at");