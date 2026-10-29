import { CALLER_TYPES, CALL_OUTCOMES } from "@leadanchor/contracts";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, tsz, updatedAt } from "./columns";
import { customers, leads } from "./crm";
import { tenantRef } from "./tenancy";

/** Where a call is inside the capture flow (see modules/calls/call-engine.ts). */
export const CALL_STATES = [
  "ringing",
  "ringing_owner",
  "bridged",
  "greeting",
  "listening",
  "consent_question",
  "consent",
  "goodbye",
  "voicemail_prompt",
  "voicemail",
  "completed",
] as const;
export type CallState = (typeof CALL_STATES)[number];

export const calls = pgTable(
  "calls",
  {
    id: pk(),
    tenantId: tenantRef(),
    provider: text("provider", { enum: ["telnyx", "simulator"] }).notNull(),
    /** Provider call session id — shared by every leg of one call. */
    providerSessionId: text("provider_session_id").notNull(),
    /** Provider id of the caller's leg (Telnyx call_control_id). */
    providerCallId: text("provider_call_id").notNull(),
    ownerLegId: text("owner_leg_id"),
    fromE164: text("from_e164").notNull(),
    toE164: text("to_e164").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    callerType: text("caller_type", { enum: CALLER_TYPES }),
    state: text("state", { enum: CALL_STATES }).notNull().default("ringing"),
    outcome: text("outcome", { enum: CALL_OUTCOMES }).notNull().default("in_progress"),
    transcript: text("transcript"),
    consentCapturedAt: tsz("consent_captured_at"),
    recordingUrl: text("recording_url"),
    hangupCause: text("hangup_cause"),
    durationSecs: integer("duration_secs"),
    startedAt: tsz("started_at").notNull().defaultNow(),
    answeredAt: tsz("answered_at"),
    endedAt: tsz("ended_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("calls_provider_session_uq").on(t.provider, t.providerSessionId),
    index("calls_provider_call_idx").on(t.providerCallId),
    index("calls_tenant_started_idx").on(t.tenantId, t.startedAt),
  ],
);

/** Normalised event trail for each call — powers the call timeline and debugging. */
export const callEvents = pgTable(
  "call_events",
  {
    id: pk(),
    tenantId: tenantRef(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: tsz("occurred_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("call_events_call_idx").on(t.callId, t.occurredAt)],
);
