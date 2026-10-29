import { FORWARDING_STATUSES, ROLES, TRACKS, TRADES } from "@leadanchor/contracts";
import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { createdAt, pk, tsz, updatedAt } from "./columns";

/** A subscribed business ("Business Partner" in the spec). Every tenant-owned row points here. */
export const tenants = pgTable("tenants", {
  id: pk(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  trade: text("trade", { enum: TRADES }).notNull(),
  track: text("track", { enum: TRACKS }).notNull(),
  timezone: text("timezone").notNull().default("America/Chicago"),
  ownerName: text("owner_name"),
  ownerCellE164: text("owner_cell_e164"),
  city: text("city"),
  state: text("state"),
  website: text("website"),
  licenseNumber: text("license_number"),
  insuranceCarrier: text("insurance_carrier"),
  yearsInBusiness: integer("years_in_business"),
  /** Self-attested by the owner (C-41): shown as "Licensed & Insured", never "Verified". */
  insurancePolicyNumber: text("insurance_policy_number"),
  /** The owner's Google Business Profile link, shown on their public profile page. */
  googleProfileUrl: text("google_profile_url"),
  /** Add the profile link to the first text a new customer gets (C-41). */
  profileLinkInTexts: boolean("profile_link_in_texts").notNull().default(true),
  /** Used only to label an *estimated* pipeline value; recovered revenue always uses real job values. */
  avgJobValueCents: integer("avg_job_value_cents").notNull().default(25_000),
  ringTimeoutSecs: integer("ring_timeout_secs").notNull().default(18),
  /** Result of the last "is my call forwarding on?" test call (C-01). */
  forwardingStatus: text("forwarding_status", { enum: FORWARDING_STATUSES }).notNull().default("unknown"),
  forwardingCheckedAt: tsz("forwarding_checked_at"),
  dispatcherEnabled: boolean("dispatcher_enabled").notNull().default(true),
  valueProofFrequency: text("value_proof_frequency", { enum: ["daily", "weekly", "off"] })
    .notNull()
    .default("weekly"),
  /** When the last value-proof summary went out (C-40), so each period sends once. */
  valueProofLastSentAt: tsz("value_proof_last_sent_at"),
  status: text("status", { enum: ["trial", "active", "past_due", "suspended", "cancelled"] })
    .notNull()
    .default("trial"),
  isDemo: boolean("is_demo").notNull().default(false),
  onboardedAt: tsz("onboarded_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tenantRef = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

export const memberships = pgTable(
  "memberships",
  {
    id: pk(),
    tenantId: tenantRef(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_tenant_user_uq").on(t.tenantId, t.userId), index("memberships_user_idx").on(t.userId)],
);

/** Provisioned numbers (C-02). Inbound calls are routed to a tenant by this table. */
export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: pk(),
    tenantId: tenantRef(),
    e164: text("e164").notNull(),
    provider: text("provider", { enum: ["telnyx", "simulator"] }).notNull(),
    providerNumberId: text("provider_number_id"),
    purpose: text("purpose", { enum: ["tracking", "forwarding"] }).notNull().default("tracking"),
    status: text("status", { enum: ["active", "pending", "released"] }).notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("phone_numbers_e164_uq").on(t.e164), index("phone_numbers_tenant_idx").on(t.tenantId)],
);
