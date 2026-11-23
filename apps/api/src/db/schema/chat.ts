import { CHAT_CHANNELS, REQUEST_SOURCES } from "@leadanchor/contracts";
import { boolean, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, tsz, updatedAt } from "./columns";
import { customers, leads, services } from "./crm";
import { tenantRef } from "./tenancy";

/**
 * One chat with a customer (C-11, C-16): a WhatsApp or text thread with one number, or one website
 * chat. The assistant answers until it hands over to the owner, or the owner takes over.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: pk(),
    tenantId: tenantRef(),
    channel: text("channel", { enum: CHAT_CHANNELS }).notNull(),
    /** The customer's number on WhatsApp and texts; null for the website chat. */
    contact: text("contact"),
    /** The website chat's browser token, looked up by hash. */
    tokenHash: text("token_hash"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    /** A website visitor's name before they leave a number. */
    visitorName: text("visitor_name"),
    /** Website chat: the website button, the Google profile or a shared link. */
    source: text("source", { enum: REQUEST_SOURCES }),
    /** The service the assistant matched on the price list. */
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    /** "owner" once the owner takes over; the assistant stays quiet until handed back. */
    handler: text("handler", { enum: ["assistant", "owner"] })
      .notNull()
      .default("assistant"),
    /** The assistant passed it to the owner, and why (a complaint, an emergency, a question it can't answer). */
    needsOwner: boolean("needs_owner").notNull().default(false),
    needsOwnerReason: text("needs_owner_reason"),
    lastInboundAt: tsz("last_inbound_at"),
    lastMessageAt: tsz("last_message_at"),
    /** Set while the assistant is writing; the website chat shows "typing". */
    assistantPendingAt: tsz("assistant_pending_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("conversations_contact_uq").on(t.tenantId, t.channel, t.contact),
    uniqueIndex("conversations_token_uq").on(t.tokenHash),
    index("conversations_recent_idx").on(t.tenantId, t.lastMessageAt),
  ],
);
