import {
  BOOKING_CANCELERS,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  CALENDAR_PROVIDERS,
  WAITLIST_STATUSES,
} from "@leadanchor/contracts";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, tsz, updatedAt } from "./columns";
import { customers, leads, services } from "./crm";
import { tenantRef } from "./tenancy";

/**
 * A booked visit (module 8, C-18): one slot on the business's day. Only "booked" rows hold
 * a slot; every booking runs under a per-business lock, so two customers can't get the same time.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: pk(),
    tenantId: tenantRef(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    /** As it was called when booked, in case the price list changes later. */
    serviceName: text("service_name"),
    startsAt: tsz("starts_at").notNull(),
    endsAt: tsz("ends_at").notNull(),
    status: text("status", { enum: BOOKING_STATUSES }).notNull().default("booked"),
    source: text("source", { enum: BOOKING_SOURCES }).notNull(),
    notes: text("notes"),
    /** The customer's page to change or cancel: looked up by hash; the sealed copy builds links. */
    tokenHash: text("token_hash"),
    tokenSealed: text("token_sealed"),
    confirmationSentAt: tsz("confirmation_sent_at"),
    reminderSentAt: tsz("reminder_sent_at"),
    confirmedAt: tsz("confirmed_at"),
    canceledAt: tsz("canceled_at"),
    canceledBy: text("canceled_by", { enum: BOOKING_CANCELERS }),
    cancelReason: text("cancel_reason"),
    /** The matching event in the owner's calendar. */
    calendarEventId: text("calendar_event_id"),
    /** A clash found in the owner's calendar, in plain words; cleared when it's gone. */
    calendarConflict: text("calendar_conflict"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("bookings_tenant_time_idx").on(t.tenantId, t.startsAt),
    index("bookings_lead_idx").on(t.leadId),
    uniqueIndex("bookings_token_uq").on(t.tokenHash),
  ],
);

/**
 * Someone who'd take a time that opens up (C-22): with no booking yet, or already booked and
 * hoping for something earlier. Texts need their own opt-in, recorded here with its wording.
 */
export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: pk(),
    tenantId: tenantRef(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    /** Already booked and hoping for earlier: taking an offer moves this booking. */
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    windowStart: tsz("window_start").notNull(),
    windowEnd: tsz("window_end").notNull(),
    smsConsentAt: tsz("sms_consent_at"),
    consentVersion: text("consent_version"),
    consentIp: text("consent_ip"),
    status: text("status", { enum: WAITLIST_STATUSES }).notNull().default("waiting"),
    lastOfferedAt: tsz("last_offered_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("waitlist_entries_tenant_idx").on(t.tenantId, t.status)],
);

/** A freed slot offered to the waitlist. The first yes takes it; the rest see it's gone. */
export const waitlistOffers = pgTable(
  "waitlist_offers",
  {
    id: pk(),
    tenantId: tenantRef(),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    serviceName: text("service_name"),
    startsAt: tsz("starts_at").notNull(),
    endsAt: tsz("ends_at").notNull(),
    status: text("status", { enum: ["open", "taken", "expired"] })
      .notNull()
      .default("open"),
    takenByEntryId: uuid("taken_by_entry_id").references(() => waitlistEntries.id, {
      onDelete: "set null",
    }),
    takenAt: tsz("taken_at"),
    expiresAt: tsz("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("waitlist_offers_tenant_idx").on(t.tenantId, t.status)],
);

/** One person's copy of an offer, with their own link to take it. */
export const waitlistOfferRecipients = pgTable(
  "waitlist_offer_recipients",
  {
    id: pk(),
    tenantId: tenantRef(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => waitlistOffers.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => waitlistEntries.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    tokenSealed: text("token_sealed").notNull(),
    textedAt: tsz("texted_at"),
    emailedAt: tsz("emailed_at"),
    declinedAt: tsz("declined_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("waitlist_recipients_token_uq").on(t.tokenHash),
    index("waitlist_recipients_offer_idx").on(t.offerId),
  ],
);

/** The business's own calendar (module 8): Google Calendar or Outlook, kept in step both ways. */
export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: pk(),
    tenantId: tenantRef(),
    provider: text("provider", { enum: CALENDAR_PROVIDERS }).notNull(),
    account: text("account"),
    /** The provider's refresh token (OAuth), encrypted. Null for the simulator. */
    credentialsSealed: text("credentials_sealed"),
    /** Where to resume the provider's change feed (incremental sync). */
    syncToken: text("sync_token"),
    lastSyncedAt: tsz("last_synced_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("calendar_connections_tenant_uq").on(t.tenantId)],
);

/** What's in that calendar, copied locally so availability never waits on the provider. */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: pk(),
    tenantId: tenantRef(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => calendarConnections.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    title: text("title"),
    startsAt: tsz("starts_at").notNull(),
    endsAt: tsz("ends_at").notNull(),
    /** LeadAnchor's own event for this booking; the rest are the owner's busy times. */
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("calendar_events_external_uq").on(t.connectionId, t.externalId),
    index("calendar_events_tenant_time_idx").on(t.tenantId, t.startsAt),
  ],
);
