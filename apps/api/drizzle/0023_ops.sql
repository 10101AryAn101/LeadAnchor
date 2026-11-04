CREATE TABLE "system_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "system_errors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"route" text NOT NULL,
	"status" integer NOT NULL,
	"message" text NOT NULL,
	"request_id" text,
	"tenant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "system_alerts_open_idx" ON "system_alerts" USING btree ("kind","resolved_at");--> statement-breakpoint
CREATE INDEX "system_errors_created_idx" ON "system_errors" USING btree ("created_at");