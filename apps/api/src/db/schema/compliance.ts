import {
  CONSENT_ACTIONS,
  CONSENT_SOURCES,
  CONSENT_TYPES,
  REGISTRATION_PATHS,
  REGISTRATION_STAGES,
  REGISTRATION_STATUSES,
} from "@leadanchor/contracts";
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, tsz, updatedAt } from "./columns";
import { tenantRef } from "./tenancy";

/** A2P 10DLC carrier registration per business (C-43). Identity data is encrypted and masked. */
export const carrierRegistrations = pgTable(
  "carrier_registrations",
  {
    id: pk(),
    tenantId: tenantRef(),
    path: text("path", { enum: REGISTRATION_PATHS }).notNull(),
    status: text("status", { enum: REGISTRATION_STATUSES }).notNull().default("not_started"),
    displayName: text("display_name").notNull(),
    taxIdEncrypted: text("tax_id_encrypted"),
    taxIdLast4: text("tax_id_last4"),
    dateOfBirthEncrypted: text("date_of_birth_encrypted"),
    /** Non-sensitive submission details (address, contact, entity type). */
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    /** The registry holding the brand below ("telnyx" or "simulator"). */
    provider: text("provider"),
    providerBrandId: text("provider_brand_id"),
    providerCampaignId: text("provider_campaign_id"),
    /** The step the review is on, or the step that failed. */
    stage: text("stage", { enum: REGISTRATION_STAGES }),
    statusReason: text("status_reason"),
    submittedAt: tsz("submitted_at"),
    otpSentAt: tsz("otp_sent_at"),
    otpVerifiedAt: tsz("otp_verified_at"),
    lastCheckedAt: tsz("last_checked_at"),
    approvedAt: tsz("approved_at"),
    /** Retention: when the encrypted tax ID / date of birth were deleted. */
    idPurgedAt: tsz("id_purged_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("carrier_registrations_tenant_uq").on(t.tenantId)],
);

/**
 * Local consent ledger (C-27). The spec names a Firebase ledger; this table is the
 * interim implementation with the same fields. The app role can only INSERT/SELECT,
 * and each row carries a hash of the previous one, so edits are detectable.
 */
export const consentLedger = pgTable(
  "consent_ledger",
  {
    id: pk(),
    tenantId: tenantRef(),
    phoneE164: text("phone_e164").notNull(),
    type: text("type", { enum: CONSENT_TYPES }).notNull(),
    action: text("action", { enum: CONSENT_ACTIONS }).notNull(),
    source: text("source", { enum: CONSENT_SOURCES }).notNull(),
    textVersion: text("text_version").notNull(),
    evidence: text("evidence"),
    ipAddress: text("ip_address"),
    grantedTo: text("granted_to").notNull(),
    callId: uuid("call_id"),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
    recordedAt: tsz("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("consent_ledger_lookup_idx").on(t.tenantId, t.phoneE164, t.type, t.recordedAt)],
);

/** Tamper-evident audit trail: append-only, hash-chained per tenant. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: pk(),
    tenantId: uuid("tenant_id"),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_tenant_idx").on(t.tenantId, t.createdAt)],
);
