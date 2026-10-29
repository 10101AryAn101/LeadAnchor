import {
  MANUAL_PAYMENT_METHODS,
  PAYMENT_ACCOUNT_STATUSES,
  PAYMENT_CAPTURES,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  QUOTE_DRAFT_SOURCES,
  QUOTE_LINE_ORIGINS,
  QUOTE_STATUSES,
} from "@leadanchor/contracts";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk, tsz, updatedAt } from "./columns";
import { customers, leads, services } from "./crm";
import { tenantRef } from "./tenancy";

/**
 * The business's own payments account (module 7): a Stripe Connect account, so card money
 * goes straight to the owner's bank and card details never touch LeadAnchor. Zelle and
 * Venmo are listed on pay links as other ways to pay.
 */
export const paymentAccounts = pgTable(
  "payment_accounts",
  {
    id: pk(),
    tenantId: tenantRef(),
    provider: text("provider", { enum: PAYMENT_PROVIDERS }),
    providerAccountId: text("provider_account_id"),
    status: text("status", { enum: PAYMENT_ACCOUNT_STATUSES }).notNull().default("not_connected"),
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    /** What the provider still needs from the owner, in plain words. */
    requirements: jsonb("requirements").$type<string[]>().notNull().default([]),
    zelle: text("zelle"),
    venmo: text("venmo"),
    lastSyncedAt: tsz("last_synced_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payment_accounts_tenant_uq").on(t.tenantId),
    uniqueIndex("payment_accounts_provider_uq").on(t.provider, t.providerAccountId),
  ],
);

/** A quote for a job (C-45). Its lines live in quote_lines; every change goes on the lead's timeline. */
export const quotes = pgTable(
  "quotes",
  {
    id: pk(),
    tenantId: tenantRef(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** Numbered per business: Q-1001, Q-1002… */
    number: integer("number").notNull(),
    status: text("status", { enum: QUOTE_STATUSES }).notNull().default("draft"),
    /** Goes up each time a sent quote is reopened for changes. */
    revision: integer("revision").notNull().default(1),
    title: text("title").notNull(),
    notes: text("notes"),
    totalCents: integer("total_cents").notNull().default(0),
    depositCents: integer("deposit_cents"),
    depositCapture: text("deposit_capture", { enum: PAYMENT_CAPTURES }).notNull().default("hold"),
    /** The customer's link is looked up by its hash; the sealed copy lets the owner copy it again. */
    tokenHash: text("token_hash"),
    tokenSealed: text("token_sealed"),
    draftSource: text("draft_source", { enum: QUOTE_DRAFT_SOURCES }).notNull(),
    draftModel: text("draft_model"),
    draftMs: integer("draft_ms"),
    draftPhotos: integer("draft_photos").notNull().default(0),
    draftNote: text("draft_note"),
    sentAt: tsz("sent_at"),
    viewedAt: tsz("viewed_at"),
    validUntil: tsz("valid_until"),
    acceptedAt: tsz("accepted_at"),
    acceptedRevision: integer("accepted_revision"),
    acceptedIp: text("accepted_ip"),
    declinedAt: tsz("declined_at"),
    declineReason: text("decline_reason"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("quotes_tenant_number_uq").on(t.tenantId, t.number),
    uniqueIndex("quotes_token_uq").on(t.tokenHash),
    index("quotes_lead_idx").on(t.leadId, t.createdAt),
  ],
);

export const quoteLines = pgTable(
  "quote_lines",
  {
    id: pk(),
    tenantId: tenantRef(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    /** From the owner's price list, or typed by the owner. Never set by the AI (C-45). */
    unitPriceCents: integer("unit_price_cents"),
    flagged: boolean("flagged").notNull().default(false),
    flagReason: text("flag_reason"),
    origin: text("origin", { enum: QUOTE_LINE_ORIGINS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("quote_lines_quote_idx").on(t.quoteId, t.position)],
);

/**
 * Money asked for or received on a job (module 7): a deposit or payment by pay link (card
 * checkout, or Zelle and Venmo shown as other ways to pay), or money the owner recorded by hand.
 * Card details stay with the payments provider; only the brand and last four digits are kept.
 */
export const paymentRequests = pgTable(
  "payment_requests",
  {
    id: pk(),
    tenantId: tenantRef(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id").references(() => quotes.id, { onDelete: "set null" }),
    kind: text("kind", { enum: PAYMENT_KINDS }).notNull(),
    capture: text("capture", { enum: PAYMENT_CAPTURES }).notNull(),
    status: text("status", { enum: PAYMENT_STATUSES }).notNull().default("open"),
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    note: text("note"),
    tokenHash: text("token_hash"),
    tokenSealed: text("token_sealed"),
    /** simulator or stripe for card checkouts; manual for money the owner recorded. */
    provider: text("provider").notNull(),
    providerCheckoutId: text("provider_checkout_id"),
    providerPaymentId: text("provider_payment_id"),
    /** The open hosted checkout, reused when the customer taps Pay again before it expires. */
    checkoutUrl: text("checkout_url"),
    checkoutExpiresAt: tsz("checkout_expires_at"),
    method: text("method", { enum: PAYMENT_METHODS }),
    cardBrand: text("card_brand"),
    cardLast4: text("card_last4"),
    heldAt: tsz("held_at"),
    holdExpiresAt: tsz("hold_expires_at"),
    holdWarnedAt: tsz("hold_warned_at"),
    paidAt: tsz("paid_at"),
    releasedAt: tsz("released_at"),
    canceledAt: tsz("canceled_at"),
    lastFailure: text("last_failure"),
    reportedMethod: text("reported_method", { enum: MANUAL_PAYMENT_METHODS }),
    reportedAt: tsz("reported_at"),
    receiptSentAt: tsz("receipt_sent_at"),
    viewedAt: tsz("viewed_at"),
    lastCheckedAt: tsz("last_checked_at"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payment_requests_token_uq").on(t.tokenHash),
    index("payment_requests_lead_idx").on(t.leadId, t.createdAt),
    index("payment_requests_status_idx").on(t.status, t.holdExpiresAt),
    index("payment_requests_checkout_idx").on(t.providerCheckoutId),
  ],
);
