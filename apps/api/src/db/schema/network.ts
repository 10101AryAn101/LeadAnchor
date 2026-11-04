import { HANDOFF_OFFER_STATUSES, HANDOFF_STATUSES, LEAD_STAGES, REFERRAL_KINDS, TRADES, URGENCY_LEVELS } from "@leadanchor/contracts";
import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, tsz, updatedAt } from "./columns";
import { leads } from "./crm";
import { tenantRef, tenants } from "./tenancy";

/** A business in the trusted pros network (C-24): it accepted the partner terms and can take passed jobs. */
export const networkMembers = pgTable("network_members", {
  tenantId: tenantRef().primaryKey(),
  /** Taking extra jobs right now; off when they're busy themselves. */
  available: boolean("available").notNull().default(true),
  /** The kinds of work it takes, its own trade first. */
  trades: text("trades", { enum: TRADES }).array().notNull(),
  termsVersion: text("terms_version").notNull(),
  termsAcceptedAt: tsz("terms_accepted_at").notNull(),
  termsAcceptedBy: text("terms_accepted_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One job a business passed to the network: who it went to, and whether the customer stayed. */
export const leadHandoffs = pgTable(
  "lead_handoffs",
  {
    id: pk(),
    /** The business that passed the job. */
    tenantId: tenantRef(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    trade: text("trade", { enum: TRADES }).notNull(),
    note: text("note"),
    status: text("status", { enum: HANDOFF_STATUSES }).notNull().default("offered"),
    /** The column the job was in, for when it comes back. */
    returnStage: text("return_stage", { enum: LEAD_STAGES }).notNull(),
    offeredTo: integer("offered_to").notNull(),
    partnerTenantId: uuid("partner_tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    partnerLeadId: uuid("partner_lead_id").references(() => leads.id, { onDelete: "set null" }),
    /** What the partner received (guardrail 5), kept for the audit trail. */
    sharedFields: text("shared_fields").array().notNull().default(sql`'{}'::text[]`),
    /** The customer's "stay with them" link. Only its hash is kept. */
    customerTokenHash: text("customer_token_hash").unique(),
    createdBy: text("created_by").notNull(),
    expiresAt: tsz("expires_at").notNull(),
    acceptedAt: tsz("accepted_at"),
    declinedAt: tsz("declined_at"),
    closedAt: tsz("closed_at"),
    convertedAt: tsz("converted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("lead_handoffs_lead_idx").on(t.tenantId, t.leadId), index("lead_handoffs_open_idx").on(t.status, t.expiresAt)],
);

/** One pro's copy of a passed job: only the work and the area until they take it (guardrail 2). */
export const handoffOffers = pgTable(
  "handoff_offers",
  {
    id: pk(),
    /** The pro it was offered to. */
    tenantId: tenantRef(),
    handoffId: uuid("handoff_id")
      .notNull()
      .references(() => leadHandoffs.id, { onDelete: "cascade" }),
    status: text("status", { enum: HANDOFF_OFFER_STATUSES }).notNull().default("pending"),
    fromBusiness: text("from_business").notNull(),
    trade: text("trade", { enum: TRADES }).notNull(),
    title: text("title").notNull(),
    area: text("area").notNull(),
    urgency: text("urgency", { enum: URGENCY_LEVELS }).notNull(),
    note: text("note"),
    expiresAt: tsz("expires_at").notNull(),
    respondedAt: tsz("responded_at"),
    /** The job on this pro's board, once they accepted. */
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("handoff_offers_uq").on(t.handoffId, t.tenantId), index("handoff_offers_tenant_idx").on(t.tenantId, t.status)],
);

/** C-25: a referral that turned into business. */
export const referralConversions = pgTable(
  "referral_conversions",
  {
    id: pk(),
    /** The business that earns from it. */
    tenantId: tenantRef(),
    kind: text("kind", { enum: REFERRAL_KINDS }).notNull(),
    /** The passed job, or the business that joined. */
    sourceId: uuid("source_id").notNull(),
    /** Counts toward a free month: the plan included referral credits when it converted. */
    counted: boolean("counted").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("referral_conversions_uq").on(t.kind, t.sourceId), index("referral_conversions_tenant_idx").on(t.tenantId)],
);

/** A free month earned with referrals (C-25), taken off the business's LeadAnchor bill. */
export const referralCredits = pgTable(
  "referral_credits",
  {
    id: pk(),
    tenantId: tenantRef(),
    /** Null until it's on the bill: one month of the tier the business pays for by then. */
    amountCents: integer("amount_cents"),
    appliedAt: tsz("applied_at"),
    createdAt: createdAt(),
  },
  (t) => [index("referral_credits_tenant_idx").on(t.tenantId)],
);
