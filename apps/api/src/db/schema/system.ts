import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { pk, tsz } from "./columns";

/**
 * Every provider webhook is stored once, keyed by the provider's event id.
 * Duplicate deliveries become no-ops, and events can be replayed for debugging.
 */
export const webhookInbox = pgTable(
  "webhook_inbox",
  {
    id: pk(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    tenantId: uuid("tenant_id"),
    status: text("status", { enum: ["received", "processed", "ignored", "failed"] }).notNull().default("received"),
    error: text("error"),
    payload: jsonb("payload").$type<unknown>().notNull(),
    receivedAt: tsz("received_at").notNull().defaultNow(),
    processedAt: tsz("processed_at"),
  },
  (t) => [uniqueIndex("webhook_inbox_event_uq").on(t.provider, t.eventId)],
);

/** Unexpected server errors (5xx), kept for the operator console and the health check (module 14). */
export const systemErrors = pgTable(
  "system_errors",
  {
    id: pk(),
    route: text("route").notNull(),
    status: integer("status").notNull(),
    message: text("message").notNull(),
    requestId: text("request_id"),
    tenantId: uuid("tenant_id"),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [index("system_errors_created_idx").on(t.createdAt)],
);

/** A problem the health check found (failing jobs, webhooks, messages or server errors); staff are emailed once. */
export const systemAlerts = pgTable(
  "system_alerts",
  {
    id: pk(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    raisedAt: tsz("raised_at").notNull().defaultNow(),
    notifiedAt: tsz("notified_at"),
    resolvedAt: tsz("resolved_at"),
  },
  (t) => [index("system_alerts_open_idx").on(t.kind, t.resolvedAt)],
);
