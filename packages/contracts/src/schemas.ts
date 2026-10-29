import { z } from "zod";
import {
  CALLER_TYPES,
  CALL_OUTCOMES,
  CONSENT_ACTIONS,
  CONSENT_SOURCES,
  CONSENT_TYPES,
  CONTACT_CHANNELS,
  INTAKE_STATUSES,
  INTEGRATIONS,
  INTEGRATION_STATES,
  LEAD_SOURCES,
  LEAD_STAGES,
  MESSAGE_CHANNELS,
  MESSAGE_DIRECTIONS,
  MESSAGE_PURPOSES,
  MESSAGE_STATUSES,
  NOTIFICATION_KINDS,
  REGISTRATION_PATHS,
  REGISTRATION_STATUSES,
  ROLES,
  TRACKS,
  TRADES,
  URGENCY_LEVELS,
  type LeadStage,
} from "./domain";
import { toE164 } from "./phone";

/* ----------------------------------------------------------------------------
 * Building blocks
 * ------------------------------------------------------------------------- */

export const usPhone = z
  .string()
  .trim()
  .min(7, "Enter a phone number")
  .transform((value, ctx) => {
    const e164 = toE164(value);
    if (!e164) {
      ctx.addIssue({ code: "custom", message: "Enter a valid US phone number" });
      return z.NEVER;
    }
    return e164;
  });

const isoDate = z.string();
const id = z.string();

/* ----------------------------------------------------------------------------
 * Session & onboarding
 * ------------------------------------------------------------------------- */

export const onboardingInput = z.object({
  businessName: z.string().trim().min(2, "Enter your business name").max(80),
  trade: z.enum(TRADES),
  ownerName: z.string().trim().min(2, "Enter your name").max(80),
  ownerCell: usPhone,
  city: z.string().trim().max(80).optional().default(""),
  state: z.string().trim().max(2).optional().default(""),
  timezone: z.string().trim().min(3).default("America/Chicago"),
  avgJobValueDollars: z.coerce.number().int().min(25).max(50_000).default(250),
});
export type OnboardingInput = z.input<typeof onboardingInput>;

export const tenantSummary = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  trade: z.enum(TRADES),
  track: z.enum(TRACKS),
  timezone: z.string(),
  trackingNumber: z.string().nullable(),
  ownerCell: z.string().nullable(),
  registrationStatus: z.enum(REGISTRATION_STATUSES),
});
export type TenantSummary = z.infer<typeof tenantSummary>;

export const meResponse = z.object({
  user: z.object({ id, name: z.string(), email: z.string() }),
  tenant: tenantSummary.nullable(),
  role: z.enum(ROLES).nullable(),
});
export type MeResponse = z.infer<typeof meResponse>;

/* ----------------------------------------------------------------------------
 * Leads (C-04, C-05, C-12, C-13, C-34)
 * ------------------------------------------------------------------------- */

export const customerRef = z.object({
  id,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  isReturning: z.boolean(),
});
export type CustomerRef = z.infer<typeof customerRef>;

export const leadCard = z.object({
  id,
  stage: z.enum(LEAD_STAGES),
  source: z.enum(LEAD_SOURCES),
  title: z.string(),
  summary: z.string().nullable(),
  urgency: z.enum(URGENCY_LEVELS),
  serviceCategory: z.string().nullable(),
  customer: customerRef,
  valueCents: z.number().int().nullable(),
  estimatedValueCents: z.number().int().nullable(),
  needsCallback: z.boolean(),
  intakeStatus: z.enum(INTAKE_STATUSES),
  /** Booked visit time, if any. Booking one moves the card to Scheduled. */
  scheduledFor: isoDate.nullable(),
  photoCount: z.number().int(),
  coverPhotoId: z.string().nullable(),
  position: z.number(),
  createdAt: isoDate,
  updatedAt: isoDate,
  lastActivityAt: isoDate,
});
export type LeadCard = z.infer<typeof leadCard>;

export const leadEvent = z.object({
  id,
  type: z.string(),
  actor: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: isoDate,
});
export type LeadEvent = z.infer<typeof leadEvent>;

export const mediaItem = z.object({
  id,
  kind: z.enum(["photo", "recording"]),
  mimeType: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  aiStatus: z.enum(["pending", "done", "failed", "skipped"]),
  aiTags: z
    .object({
      summary: z.string().optional(),
      issue: z.string().optional(),
      itemType: z.string().optional(),
      brand: z.string().optional(),
      model: z.string().optional(),
      urgency: z.enum(URGENCY_LEVELS).optional(),
      visibleRisks: z.array(z.string()).optional(),
      confidence: z.number().optional(),
    })
    .nullable(),
  createdAt: isoDate,
});
export type MediaItem = z.infer<typeof mediaItem>;

export const messageItem = z.object({
  id,
  direction: z.enum(MESSAGE_DIRECTIONS),
  channel: z.enum(MESSAGE_CHANNELS),
  purpose: z.enum(MESSAGE_PURPOSES),
  status: z.enum(MESSAGE_STATUSES),
  body: z.string(),
  blockedReason: z.string().nullable(),
  provider: z.string(),
  createdAt: isoDate,
});
export type MessageItem = z.infer<typeof messageItem>;

export const callItem = z.object({
  id,
  from: z.string(),
  to: z.string(),
  callerType: z.enum(CALLER_TYPES).nullable(),
  outcome: z.enum(CALL_OUTCOMES),
  customer: customerRef.nullable(),
  leadId: z.string().nullable(),
  durationSecs: z.number().int().nullable(),
  transcript: z.string().nullable(),
  consentCapturedAt: isoDate.nullable(),
  startedAt: isoDate,
  endedAt: isoDate.nullable(),
});
export type CallItem = z.infer<typeof callItem>;

export const leadDetail = leadCard.extend({
  lostReason: z.string().nullable(),
  events: z.array(leadEvent),
  calls: z.array(callItem),
  messages: z.array(messageItem),
  media: z.array(mediaItem),
  otherLeads: z.array(leadCard.pick({ id: true, title: true, stage: true, createdAt: true, valueCents: true })),
  intakeUrl: z.string().nullable(),
});
export type LeadDetail = z.infer<typeof leadDetail>;

export const leadUpdateInput = z.object({
  stage: z.enum(LEAD_STAGES).optional(),
  position: z.number().optional(),
  title: z.string().trim().min(1).max(140).optional(),
  valueDollars: z.number().min(0).max(1_000_000).nullable().optional(),
  lostReason: z.string().trim().max(200).nullable().optional(),
  customerName: z.string().trim().max(80).optional(),
  scheduledFor: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type LeadUpdateInput = z.infer<typeof leadUpdateInput>;

export const leadContactInput = z.object({ channel: z.enum(CONTACT_CHANNELS) });

/* ----------------------------------------------------------------------------
 * Customers (C-34): one person's whole history with the business
 * ------------------------------------------------------------------------- */

export const customerListItem = z.object({
  id,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  jobs: z.number().int(),
  openJobs: z.number().int(),
  wonJobs: z.number().int(),
  /** Real job values of won jobs only — never estimates. */
  lifetimeValueCents: z.number().int(),
  lastActivityAt: isoDate,
});
export type CustomerListItem = z.infer<typeof customerListItem>;

export const customerJob = z.object({
  id,
  title: z.string(),
  stage: z.enum(LEAD_STAGES),
  source: z.enum(LEAD_SOURCES),
  serviceCategory: z.string().nullable(),
  urgency: z.enum(URGENCY_LEVELS),
  valueCents: z.number().int().nullable(),
  estimatedValueCents: z.number().int().nullable(),
  scheduledFor: isoDate.nullable(),
  createdAt: isoDate,
  wonAt: isoDate.nullable(),
});
export type CustomerJob = z.infer<typeof customerJob>;

export const customerDetail = z.object({
  id,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  firstSeenAt: isoDate,
  stats: z.object({
    jobs: z.number().int(),
    openJobs: z.number().int(),
    wonJobs: z.number().int(),
    lifetimeValueCents: z.number().int(),
  }),
  jobs: z.array(customerJob),
  calls: z.array(callItem),
  photos: z.array(z.object({ id, leadId: z.string(), issue: z.string().nullable(), createdAt: isoDate })),
});
export type CustomerDetail = z.infer<typeof customerDetail>;

/** Answer to "the owner tapped Call/Text": where the card moved, if it did. */
export interface LeadContactResult {
  moved: { from: LeadStage; to: LeadStage } | null;
}

export const noteInput = z.object({ text: z.string().trim().min(1).max(2000) });

/* ----------------------------------------------------------------------------
 * Dashboard (C-14) and value proof (C-40)
 * ------------------------------------------------------------------------- */

export const dashboardRange = z.enum(["7d", "30d", "90d"]);
export type DashboardRange = z.infer<typeof dashboardRange>;

export const dashboardSummary = z.object({
  range: dashboardRange,
  recoveredCents: z.number().int(),
  pipelineCents: z.number().int(),
  missedCalls: z.number().int(),
  callsCaptured: z.number().int(),
  answeredCalls: z.number().int(),
  ghostCalls: z.number().int(),
  dispatcherConversations: z.number().int(),
  voicemails: z.number().int(),
  leadsCreated: z.number().int(),
  leadsWon: z.number().int(),
  winRate: z.number(),
  needsCallback: z.number().int(),
  series: z.array(z.object({ date: z.string(), captured: z.number().int(), won: z.number().int() })),
  sources: z.array(z.object({ source: z.enum(LEAD_SOURCES), count: z.number().int() })),
  /** New leads in the period by urgency (C-14). */
  urgency: z.record(z.enum(URGENCY_LEVELS), z.number().int()),
  valueProof: z.object({ headline: z.string(), detail: z.string() }),
});
export type DashboardSummary = z.infer<typeof dashboardSummary>;

/* ----------------------------------------------------------------------------
 * Service catalogue (C-17): what the business offers, how long it takes, what it costs
 * ------------------------------------------------------------------------- */

export const serviceItem = z.object({
  id,
  name: z.string(),
  description: z.string().nullable(),
  durationMins: z.number().int().nullable(),
  priceCents: z.number().int().nullable(),
  /** Shown to customers on the request form. Hidden services stay for history. */
  active: z.boolean(),
  sortOrder: z.number().int(),
});
export type ServiceItem = z.infer<typeof serviceItem>;

export const serviceInput = z.object({
  name: z.string().trim().min(2, "Enter a name").max(80),
  description: z.string().trim().max(200).nullable().optional(),
  durationMins: z.number().int().min(5, "At least 5 minutes").max(24 * 60).nullable().optional(),
  priceDollars: z.number().min(0).max(100_000).nullable().optional(),
  active: z.boolean().optional(),
});
export type ServiceInput = z.infer<typeof serviceInput>;

export const serviceUpdateInput = serviceInput.partial();
export type ServiceUpdateInput = z.infer<typeof serviceUpdateInput>;

/** The full list of service ids in their new order. */
export const serviceOrderInput = z.object({ ids: z.array(z.string()).min(1).max(200) });

/* ----------------------------------------------------------------------------
 * Notifications
 * ------------------------------------------------------------------------- */

export const notificationItem = z.object({
  id,
  kind: z.enum(NOTIFICATION_KINDS),
  title: z.string(),
  body: z.string(),
  leadId: z.string().nullable(),
  readAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type NotificationItem = z.infer<typeof notificationItem>;

/* ----------------------------------------------------------------------------
 * Public intake form (C-07, C-08, C-09)
 * ------------------------------------------------------------------------- */

export const intakeContext = z.object({
  business: z.object({
    name: z.string(),
    trade: z.enum(TRADES),
    city: z.string().nullable(),
    state: z.string().nullable(),
    licenseNumber: z.string().nullable(),
    insured: z.boolean(),
    yearsInBusiness: z.number().int().nullable(),
    phone: z.string().nullable(),
  }),
  services: z.array(z.object({ id, name: z.string(), description: z.string().nullable() })),
  customerName: z.string().nullable(),
  status: z.enum(["open", "submitted", "expired"]),
});
export type IntakeContext = z.infer<typeof intakeContext>;

export const intakeSubmitFields = z.object({
  serviceId: z.string().optional(),
  details: z.string().trim().min(3, "Tell us a little about the job").max(2000),
  contactName: z.string().trim().min(1, "Enter your name").max(80),
  address: z.string().trim().max(200).optional().default(""),
  preferredTime: z.string().trim().max(120).optional().default(""),
  /** The plain-language "text me about this request" checkbox (feeds the consent ledger, C-27). */
  smsConsent: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "on"),
});
export type IntakeSubmitFields = z.input<typeof intakeSubmitFields>;

/** Exact wording shown next to the checkbox — versioned so the ledger proves what was agreed to. */
export const INTAKE_CONSENT_TEXT =
  "Text me about this request. Messages are about this job only; reply STOP to opt out. Msg & data rates may apply.";
export const INTAKE_CONSENT_VERSION = "intake-form-v1";

/* ----------------------------------------------------------------------------
 * Settings & compliance (C-01, C-27, C-43)
 * ------------------------------------------------------------------------- */

export const settingsResponse = z.object({
  businessName: z.string(),
  trade: z.enum(TRADES),
  ownerName: z.string().nullable(),
  ownerCell: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  timezone: z.string(),
  licenseNumber: z.string().nullable(),
  insuranceCarrier: z.string().nullable(),
  yearsInBusiness: z.number().int().nullable(),
  avgJobValueCents: z.number().int(),
  ringTimeoutSecs: z.number().int(),
  dispatcherEnabled: z.boolean(),
  valueProofFrequency: z.enum(["daily", "weekly", "off"]),
  trackingNumber: z.string().nullable(),
});
export type SettingsResponse = z.infer<typeof settingsResponse>;

export const settingsUpdateInput = z.object({
  businessName: z.string().trim().min(2).max(80).optional(),
  ownerName: z.string().trim().min(2).max(80).optional(),
  ownerCell: usPhone.optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(2).optional(),
  timezone: z.string().trim().min(3).optional(),
  licenseNumber: z.string().trim().max(40).nullable().optional(),
  insuranceCarrier: z.string().trim().max(80).nullable().optional(),
  yearsInBusiness: z.number().int().min(0).max(150).nullable().optional(),
  avgJobValueDollars: z.number().int().min(25).max(50_000).optional(),
  ringTimeoutSecs: z.number().int().min(10).max(30).optional(),
  dispatcherEnabled: z.boolean().optional(),
  valueProofFrequency: z.enum(["daily", "weekly", "off"]).optional(),
});
export type SettingsUpdateInput = z.infer<typeof settingsUpdateInput>;

const address = {
  street: z.string().trim().min(3, "Enter the street address").max(120),
  city: z.string().trim().min(2, "Enter the city").max(80),
  state: z.string().trim().length(2, "Use the 2-letter state code"),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a valid ZIP code"),
};

export const registrationInput = z.discriminatedUnion("path", [
  z.object({
    path: z.literal("standard"),
    legalName: z.string().trim().min(2, "Enter the exact legal name on your IRS records").max(120),
    ein: z.string().trim().regex(/^\d{2}-?\d{7}$/, "EIN looks like 12-3456789"),
    entityType: z.enum(["PRIVATE_PROFIT", "PUBLIC_PROFIT", "NON_PROFIT"]),
    website: z.string().trim().max(200).optional().default(""),
    contactName: z.string().trim().min(2).max(80),
    contactEmail: z.email("Enter a valid email"),
    contactPhone: usPhone,
    ...address,
  }),
  z.object({
    path: z.literal("sole_proprietor"),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    mobile: usPhone,
    email: z.email("Enter a valid email"),
    ...address,
  }),
]);
export type RegistrationInput = z.input<typeof registrationInput>;

export const registrationResponse = z.object({
  path: z.enum(REGISTRATION_PATHS).nullable(),
  status: z.enum(REGISTRATION_STATUSES),
  statusCopy: z.string(),
  displayName: z.string().nullable(),
  maskedTaxId: z.string().nullable(),
  submittedAt: isoDate.nullable(),
  approvedAt: isoDate.nullable(),
  smsEnabled: z.boolean(),
});
export type RegistrationResponse = z.infer<typeof registrationResponse>;

export const consentEntry = z.object({
  id,
  phone: z.string(),
  type: z.enum(CONSENT_TYPES),
  action: z.enum(CONSENT_ACTIONS),
  source: z.enum(CONSENT_SOURCES),
  textVersion: z.string(),
  evidence: z.string().nullable(),
  recordedAt: isoDate,
});
export type ConsentEntry = z.infer<typeof consentEntry>;

export const integrationStatus = z.object({
  key: z.enum(INTEGRATIONS),
  name: z.string(),
  purpose: z.string(),
  capabilities: z.array(z.string()),
  state: z.enum(INTEGRATION_STATES),
  detail: z.string(),
  mandatedBySpec: z.boolean(),
});
export type IntegrationStatus = z.infer<typeof integrationStatus>;

/* ----------------------------------------------------------------------------
 * Local call simulator (development only)
 * ------------------------------------------------------------------------- */

export const simulatorScenarioInput = z.object({
  callerPhone: usPhone,
  callerName: z.string().trim().max(80).optional(),
  ownerBehavior: z.enum(["no_answer", "answers", "carrier_voicemail"]),
  callerBehavior: z.enum(["hangs_up_while_ringing", "talks_to_dispatcher", "hangs_up_during_greeting"]),
  utterance: z.string().trim().max(500).optional().default(""),
  consent: z.enum(["yes", "no"]).default("yes"),
  voicemailText: z.string().trim().max(1000).optional().default(""),
});
export type SimulatorScenarioInput = z.input<typeof simulatorScenarioInput>;

export const simulatorPhoneMessage = z.object({
  id,
  from: z.string(),
  body: z.string(),
  channel: z.enum(MESSAGE_CHANNELS),
  createdAt: isoDate,
});
export type SimulatorPhoneMessage = z.infer<typeof simulatorPhoneMessage>;

/* ----------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------- */

export const apiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
});
export type ApiError = z.infer<typeof apiError>;
