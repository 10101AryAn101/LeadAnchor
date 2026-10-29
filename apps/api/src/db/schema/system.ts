import { jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
