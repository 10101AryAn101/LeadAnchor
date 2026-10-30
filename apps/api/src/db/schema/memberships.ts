import {
  INVOICE_STATUSES,
  MEMBERSHIP_STATUSES,
  PAYMENT_PROVIDERS,
  PLAN_INTERVALS,
  PLAN_STATUSES,
  type WorkCadence,
} from "@leadanchor/contracts";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, tsz, updatedAt } from "./columns";
import { customers, leads, services } from "./crm";
import { tenantRef } from "./tenancy";

/**
 * A maintenance plan the business sells to its own customers (C-48), e.g. "Gold AC Care, $99 a
 * month". Stripe holds it as a Product with a Price; a price change makes a new Price for new
 * members, and existing members keep theirs (C-48 AC 2).
 */
export const membershipPlans = pgTable(
  "membership_plans",
  {
    id: pk(),
    tenantId: tenantRef(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    priceCents: integer("price_cents").notNull(),
    interval: text("interval", { enum: PLAN_INTERVALS }).notNull(),
    includes: jsonb("includes").$type<string[]>().notNull().default([]),
    /** The job a paid bill puts on the board, and how often (C-51). */
    workServiceId: uuid("work_service_id").references(() => services.id, { onDelete: "set null" }),
    workCadence: jsonb("work_cadence").$type<WorkCadence>().notNull(),
    welcomeMessage: text("welcome_message").notNull().default(""),
    status: text("status", { enum: PLAN_STATUSES }).notNull().default("active"),
    /** The public sign-up link's token: meant to be shared, so not a secret. */
    linkToken: text("link_token").notNull().unique(),
    provider: text("provider", { enum: PAYMENT_PROVIDERS }),
    providerProductId: text("provider_product_id"),
    /** The Price new members join at. */
    providerPriceId: text("provider_price_id"),
    archivedAt: tsz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("membership_plans_tenant_idx").on(t.tenantId, t.status)],
);

/**
 * One customer's subscription to a plan (C-49, C-50), mirroring Stripe's. ("memberships" is the
 * team table: who works for which business.)
 */
export const planMemberships = pgTable(
  "plan_memberships",
  {
    id: pk(),
    tenantId: tenantRef(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => membershipPlans.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    status: text("status", { enum: MEMBERSHIP_STATUSES }).notNull().default("pending"),
    /** Their own price and Stripe Price, kept when the plan's price changes. */
    priceCents: integer("price_cents").notNull(),
    interval: text("interval", { enum: PLAN_INTERVALS }).notNull(),
    providerPriceId: text("provider_price_id"),
    /** Receipts and the manage link go here. */
    email: text("email").notNull(),
    provider: text("provider", { enum: PAYMENT_PROVIDERS }),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    providerCheckoutId: text("provider_checkout_id"),
    cardBrand: text("card_brand"),
    cardLast4: text("card_last4"),
    startedAt: tsz("started_at"),
    currentPeriodEnd: tsz("current_period_end"),
    pausedAt: tsz("paused_at"),
    canceledAt: tsz("canceled_at"),
    /** Canceled: they keep the plan until here. */
    endsAt: tsz("ends_at"),
    canceledBy: text("canceled_by", { enum: ["customer", "owner"] }),
    /** ROSCA (C-49 AC 1): the exact words they agreed to, which version, when and from where. */
    consentText: text("consent_text").notNull(),
    consentVersion: text("consent_version").notNull(),
    consentAt: tsz("consent_at").notNull(),
    consentIp: text("consent_ip"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("plan_memberships_tenant_idx").on(t.tenantId, t.status),
    index("plan_memberships_customer_idx").on(t.tenantId, t.customerId),
    uniqueIndex("plan_memberships_subscription_uq").on(t.provider, t.providerSubscriptionId),
  ],
);

/** Each bill: paid, being retried, or failed after every retry (C-49), and the job it made (C-51). */
export const membershipInvoices = pgTable(
  "membership_invoices",
  {
    id: pk(),
    tenantId: tenantRef(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => planMemberships.id, { onDelete: "cascade" }),
    providerInvoiceId: text("provider_invoice_id").notNull(),
    kind: text("kind", { enum: ["cycle", "proration"] }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: text("status", { enum: INVOICE_STATUSES }).notNull(),
    periodStart: tsz("period_start"),
    periodEnd: tsz("period_end"),
    paidAt: tsz("paid_at"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: tsz("next_attempt_at"),
    failure: text("failure"),
    /** C-51: set once the bill's job is made, so a re-delivered webhook makes no second card. */
    workDoneAt: tsz("work_done_at"),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    receiptSentAt: tsz("receipt_sent_at"),
    /** The last failed attempt the member was told about, so each decline is one notice. */
    noticedAttempts: integer("noticed_attempts").notNull().default(0),
    ownerAlertedAt: tsz("owner_alerted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("membership_invoices_provider_uq").on(t.tenantId, t.providerInvoiceId),
    index("membership_invoices_membership_idx").on(t.membershipId, t.createdAt),
  ],
);
