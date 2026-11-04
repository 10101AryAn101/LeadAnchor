import { ACCOUNT_STATUSES, type BookingSettings, FORWARDING_STATUSES, REPLY_TONES, ROLES, TIERS, TRACKS, TRADES, WEBSITE_STATUSES } from "@leadanchor/contracts";
import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
  /** Mailing address: printed in marketing-type emails (CAN-SPAM) and kept on the Google listing. */
  streetAddress: text("street_address"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
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
  /** Opening hours and booking rules (module 8). Null until the owner sets them: the defaults apply. */
  booking: jsonb("booking").$type<BookingSettings>(),
  /** The chat assistant answers WhatsApp, the website chat and texts (C-16). */
  assistantEnabled: boolean("assistant_enabled").notNull().default(true),
  /** What the owner wants the assistant to know beyond the price list and hours. */
  assistantNotes: text("assistant_notes"),
  /** The voice of AI-drafted replies to Google reviews (C-47 AC 5). */
  reviewReplyTone: text("review_reply_tone", { enum: REPLY_TONES }).notNull().default("warm"),
  status: text("status", { enum: ACCOUNT_STATUSES }).notNull().default("trial"),
  /** The LeadAnchor tier the business pays for; null while it's on the free trial. */
  tier: text("tier", { enum: TIERS }),
  /** Every new business tries everything for TRIAL_DAYS; existing ones got the same from the day tiers arrived. */
  trialEndsAt: tsz("trial_ends_at").default(sql`now() + interval '14 days'`),
  /** LeadAnchor's own Stripe customer and subscription for this business (on LeadAnchor's account, not theirs). */
  billingCustomerId: text("billing_customer_id"),
  billingSubscriptionId: text("billing_subscription_id"),
  billingPeriodEnd: tsz("billing_period_end"),
  /** Set when the owner has cancelled: the tier stays until this date, then the account closes. */
  billingCancelsAt: tsz("billing_cancels_at"),
  /** C-33: the website add-on (its own subscription: hosting monthly, setup on the first bill). */
  websiteStatus: text("website_status", { enum: WEBSITE_STATUSES }).notNull().default("none"),
  websiteSubscriptionId: text("website_subscription_id"),
  /** Hosting was stopped: the site stays up until this date. */
  websiteCancelsAt: tsz("website_cancels_at"),
  isDemo: boolean("is_demo").notNull().default(false),
  /** C-25: the code in this business's "refer a business" link. */
  referralCode: text("referral_code")
    .notNull()
    .unique()
    .default(sql`upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8))`),
  /** C-42: the owner switched off the AI-readable page and the monthly mention check. */
  aiDiscoveryOptOut: boolean("ai_discovery_opt_out").notNull().default(false),
  /** The business whose referral link this one joined with. */
  referredByTenantId: uuid("referred_by_tenant_id").references((): AnyPgColumn => tenants.id, { onDelete: "set null" }),
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
