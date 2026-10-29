import { INTAKE_STATUSES, LEAD_SOURCES, LEAD_STAGES, URGENCY_LEVELS } from "@leadanchor/contracts";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk, tsz, updatedAt } from "./columns";
import { tenantRef } from "./tenancy";

/** Customer master data ("Customer MDM"). One row per person per business, keyed by phone. */
export const customers = pgTable(
  "customers",
  {
    id: pk(),
    tenantId: tenantRef(),
    phoneE164: text("phone_e164"),
    name: text("name"),
    email: text("email"),
    address: text("address"),
    notes: text("notes"),
    firstSeenAt: tsz("first_seen_at").notNull().defaultNow(),
    lastContactAt: tsz("last_contact_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("customers_tenant_phone_uq").on(t.tenantId, t.phoneE164)],
);

/** Service catalogue (C-17): drives the intake dropdown now, scheduling and quotes later. */
export const services = pgTable(
  "services",
  {
    id: pk(),
    tenantId: tenantRef(),
    name: text("name").notNull(),
    description: text("description"),
    durationMins: integer("duration_mins"),
    priceCents: integer("price_cents"),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("services_tenant_idx").on(t.tenantId, t.sortOrder)],
);

/** A lead / job — one card on the board (C-12). */
export const leads = pgTable(
  "leads",
  {
    id: pk(),
    tenantId: tenantRef(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    stage: text("stage", { enum: LEAD_STAGES }).notNull().default("new"),
    source: text("source", { enum: LEAD_SOURCES }).notNull(),
    title: text("title").notNull(),
    /** Set when the owner edits the title, so AI enrichment never overwrites their wording. */
    titleLocked: boolean("title_locked").notNull().default(false),
    summary: text("summary"),
    serviceCategory: text("service_category"),
    urgency: text("urgency", { enum: URGENCY_LEVELS }).notNull().default("normal"),
    /** Real job value set by the owner (quote / invoice). Recovered revenue is computed from this only. */
    valueCents: integer("value_cents"),
    /** Clearly-labelled estimate (tenant average job value) used for the open pipeline figure. */
    estimatedValueCents: integer("estimated_value_cents"),
    needsCallback: boolean("needs_callback").notNull().default(false),
    intakeStatus: text("intake_status", { enum: INTAKE_STATUSES }).notNull().default("none"),
    position: doublePrecision("position").notNull().default(0),
    lostReason: text("lost_reason"),
    /** Booked visit time. Setting it moves the card to Scheduled. */
    scheduledFor: tsz("scheduled_for"),
    stageChangedAt: tsz("stage_changed_at").notNull().defaultNow(),
    wonAt: tsz("won_at"),
    lastActivityAt: tsz("last_activity_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("leads_board_idx").on(t.tenantId, t.stage, t.position),
    index("leads_customer_idx").on(t.tenantId, t.customerId),
    index("leads_created_idx").on(t.tenantId, t.createdAt),
  ],
);

/** Append-only timeline for a lead: calls, AI results, consent, messages, stage moves, notes. */
export const leadEvents = pgTable(
  "lead_events",
  {
    id: pk(),
    tenantId: tenantRef(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actor: text("actor").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("lead_events_lead_idx").on(t.leadId, t.createdAt)],
);
