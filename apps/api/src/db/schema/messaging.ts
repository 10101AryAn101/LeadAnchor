import {
  MESSAGE_CHANNELS,
  MESSAGE_DIRECTIONS,
  MESSAGE_PURPOSES,
  MESSAGE_STATUSES,
  NOTIFICATION_KINDS,
} from "@leadanchor/contracts";
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, tsz } from "./columns";
import { customers, leads } from "./crm";
import { tenantRef } from "./tenancy";

/**
 * Every outbound and inbound message. Outbound rows are written by the governed
 * send path only (modules/messaging) together with the policy decision that allowed or blocked them.
 */
export const messages = pgTable(
  "messages",
  {
    id: pk(),
    tenantId: tenantRef(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    direction: text("direction", { enum: MESSAGE_DIRECTIONS }).notNull(),
    channel: text("channel", { enum: MESSAGE_CHANNELS }).notNull(),
    purpose: text("purpose", { enum: MESSAGE_PURPOSES }).notNull(),
    status: text("status", { enum: MESSAGE_STATUSES }).notNull(),
    toAddress: text("to_address").notNull(),
    fromAddress: text("from_address").notNull(),
    body: text("body").notNull(),
    blockedReason: text("blocked_reason"),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    policy: jsonb("policy").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: createdAt(),
    sentAt: tsz("sent_at"),
    deliveredAt: tsz("delivered_at"),
  },
  (t) => [
    index("messages_customer_idx").on(t.tenantId, t.customerId, t.createdAt),
    index("messages_lead_idx").on(t.leadId),
    index("messages_to_idx").on(t.toAddress, t.createdAt),
  ],
);

/** Owner alerts (C-05 "tap to call back", C-40 value proof). Delivered in-app and via FCM push when configured. */
export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    tenantId: tenantRef(),
    kind: text("kind", { enum: NOTIFICATION_KINDS }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    pushStatus: text("push_status", { enum: ["in_app", "fcm_sent", "fcm_failed"] }).notNull().default("in_app"),
    readAt: tsz("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_tenant_idx").on(t.tenantId, t.createdAt)],
);
