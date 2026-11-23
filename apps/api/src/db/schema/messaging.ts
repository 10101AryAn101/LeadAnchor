import {
  EMAIL_FEEDBACK_TYPES,
  MESSAGE_AUTHORS,
  MESSAGE_CHANNELS,
  MESSAGE_DIRECTIONS,
  MESSAGE_PURPOSES,
  MESSAGE_STATUSES,
  NOTIFICATION_KINDS,
  PUSH_PROVIDERS,
  PUSH_STATUSES,
} from "@leadanchor/contracts";
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./chat";
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
    /** Email only. */
    subject: text("subject"),
    body: text("body").notNull(),
    /** Email only: the designed version of a campaign email (the body is its plain-text twin). */
    html: text("html"),
    /** Email only: where replies go, e.g. the owner's own inbox for a campaign (module 11). */
    replyTo: text("reply_to"),
    /** Email only: the email service reported it bounced, or the person marked it as spam. */
    feedback: text("feedback", { enum: EMAIL_FEEDBACK_TYPES }),
    blockedReason: text("blocked_reason"),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    policy: jsonb("policy").$type<Record<string, unknown>>(),
    error: text("error"),
    /** Chats (C-11, C-16): the thread it belongs to, and who wrote it. */
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    author: text("author", { enum: MESSAGE_AUTHORS }),
    createdAt: createdAt(),
    sentAt: tsz("sent_at"),
    deliveredAt: tsz("delivered_at"),
  },
  (t) => [
    index("messages_customer_idx").on(t.tenantId, t.customerId, t.createdAt),
    index("messages_lead_idx").on(t.leadId),
    index("messages_to_idx").on(t.toAddress, t.createdAt),
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
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
    pushStatus: text("push_status", { enum: PUSH_STATUSES }).notNull().default("in_app"),
    readAt: tsz("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_tenant_idx").on(t.tenantId, t.createdAt)],
);

/** Phones and browsers that get the owner's alerts as push notifications (C-05). */
export const pushDevices = pgTable(
  "push_devices",
  {
    id: pk(),
    tenantId: tenantRef(),
    userId: text("user_id").notNull(),
    provider: text("provider", { enum: PUSH_PROVIDERS }).notNull(),
    /** Firebase registration token, or a simulator-issued one. */
    token: text("token").notNull(),
    label: text("label").notNull(),
    lastAlertAt: tsz("last_alert_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("push_devices_token_uq").on(t.token), index("push_devices_tenant_idx").on(t.tenantId)],
);
