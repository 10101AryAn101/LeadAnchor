import {
  type CampaignAudience,
  type CampaignTrigger,
  CAMPAIGN_KINDS,
  CAMPAIGN_STATUSES,
  RECIPIENT_STATUSES,
} from "@leadanchor/contracts";
import { date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, tsz, updatedAt } from "./columns";
import { customers, leads, services } from "./crm";
import { messages } from "./messaging";
import { tenantRef } from "./tenancy";

/**
 * An email campaign (module 11): who it goes to, what it says and offers, and when. A weather or
 * holiday trigger can draft one ("suggested"), but only the owner's approval sends it (C-30).
 */
export const campaigns = pgTable(
  "campaigns",
  {
    id: pk(),
    tenantId: tenantRef(),
    kind: text("kind", { enum: CAMPAIGN_KINDS }).notNull(),
    status: text("status", { enum: CAMPAIGN_STATUSES }).notNull().default("draft"),
    name: text("name").notNull(),
    audience: jsonb("audience").$type<CampaignAudience>().notNull(),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    /** "$20 off a drain cleaning": shown in the email and on the booking page. */
    offer: text("offer"),
    offerEndsOn: date("offer_ends_on", { mode: "string" }),
    /** The service the booking button opens with (C-44). */
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    /** What drafted it (C-30), and a key so the same freeze or holiday drafts only one. */
    trigger: jsonb("trigger").$type<CampaignTrigger>(),
    triggerKey: text("trigger_key"),
    suggestedUntil: tsz("suggested_until"),
    scheduledFor: tsz("scheduled_for"),
    /** The owner's approval: nothing goes out without it. */
    approvedAt: tsz("approved_at"),
    approvedBy: text("approved_by"),
    /** Replies go to the owner who approved it. */
    replyTo: text("reply_to"),
    sentAt: tsz("sent_at"),
    canceledAt: tsz("canceled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("campaigns_tenant_idx").on(t.tenantId, t.status, t.createdAt),
    uniqueIndex("campaigns_trigger_uq").on(t.tenantId, t.triggerKey),
  ],
);

/**
 * Everyone a sent campaign reached or left out, and why: the audit trail of who was emailed, on
 * what basis and when (C-44 AC 6), plus what they did with it (clicked, booked, unsubscribed).
 */
export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: pk(),
    tenantId: tenantRef(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Lower-cased, as it was when sent; null for someone left out for having none. */
    email: text("email"),
    name: text("name"),
    status: text("status", { enum: RECIPIENT_STATUSES }).notNull(),
    skipReason: text("skip_reason"),
    /** Why the email was lawful to send: "Customer: work done Mar 2026" (CAN-SPAM's existing-relationship basis). */
    basis: text("basis").notNull(),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    /** The tracked link's token, by hash. */
    tokenHash: text("token_hash").unique(),
    sentAt: tsz("sent_at"),
    clickedAt: tsz("clicked_at"),
    clicks: integer("clicks").notNull().default(0),
    bookedAt: tsz("booked_at"),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    unsubscribedAt: tsz("unsubscribed_at"),
    complainedAt: tsz("complained_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("campaign_recipients_email_uq").on(t.campaignId, t.email),
    index("campaign_recipients_email_idx").on(t.tenantId, t.email, t.createdAt),
    index("campaign_recipients_message_idx").on(t.messageId),
  ],
);
