import { z } from "zod";
import {
  BOOKING_CANCELERS,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  CALENDAR_PROVIDERS,
  CALLER_TYPES,
  CALL_OUTCOMES,
  CONSENT_ACTIONS,
  CONSENT_SOURCES,
  CONSENT_TYPES,
  CONTACT_CHANNELS,
  FORWARDING_STATUSES,
  INTAKE_STATUSES,
  INTEGRATIONS,
  INTEGRATION_STATES,
  LEAD_SOURCES,
  LEAD_STAGES,
  LISTING_PROVIDERS,
  MANUAL_PAYMENT_METHODS,
  MAX_PAYMENT_CENTS,
  MAX_QUOTE_LINES,
  MAX_TAGS_PER_JOB,
  MESSAGE_CHANNELS,
  MESSAGE_DIRECTIONS,
  MESSAGE_PURPOSES,
  MESSAGE_STATUSES,
  NOTIFICATION_KINDS,
  PAYMENT_ACCOUNT_STATUSES,
  PAYMENT_CAPTURES,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  PUSH_PROVIDERS,
  QUOTE_DRAFT_SOURCES,
  QUOTE_LINE_ORIGINS,
  QUOTE_STATUSES,
  REGISTRATION_PATHS,
  REGISTRATION_STAGES,
  REGISTRATION_STATUSES,
  REGISTRY_TEST_OUTCOMES,
  REPLY_TONES,
  REQUEST_SOURCES,
  REVIEW_REPLY_STATUSES,
  REVIEW_REQUEST_OUTCOMES,
  ROLES,
  TRACKS,
  TRADES,
  URGENCY_LEVELS,
  WAITLIST_STATUSES,
  WEEKDAY_KEYS,
  type LeadStage,
  type Track,
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
  /** The owner's own labels, e.g. "Warranty" (module 4). */
  tags: z.array(z.string()),
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
  /** Shown in the business's public work gallery (C-41). */
  showcase: z.boolean(),
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

export const mediaUpdateInput = z.object({ showcase: z.boolean() });

/** Optional body of "send the request form": whether to add the profile link (C-41). */
export const requestDetailsInput = z.object({ includeProfile: z.boolean().optional() }).default({});

/* ----------------------------------------------------------------------------
 * Public profile page (C-41): what anyone with the link can see. No customer data.
 * ------------------------------------------------------------------------- */

export const publicProfile = z.object({
  name: z.string(),
  trade: z.enum(TRADES),
  city: z.string().nullable(),
  state: z.string().nullable(),
  phone: z.string().nullable(),
  /** All self-attested by the owner — labelled "Licensed & Insured", never "Verified". */
  licenseNumber: z.string().nullable(),
  insuranceCarrier: z.string().nullable(),
  yearsInBusiness: z.number().int().nullable(),
  googleProfileUrl: z.string().nullable(),
  website: z.string().nullable(),
  services: z.array(z.object({ name: z.string(), description: z.string().nullable() })),
  photos: z.array(z.object({ id, caption: z.string().nullable() })),
  /** The booking page, when the business takes online bookings (C-18). */
  bookingUrl: z.string().nullable(),
  /** The Google rating, from the connected listing (C-41 AC 2, C-21). */
  rating: z.object({ average: z.number(), count: z.number().int(), url: z.string().nullable() }).nullable(),
  /** Google reviews the owner chose to show; only ones already public on Google (C-23). */
  reviews: z.array(z.object({ reviewer: z.string(), rating: z.number().int(), text: z.string(), publishedAt: isoDate })),
});
export type PublicProfile = z.infer<typeof publicProfile>;

export const messageItem = z.object({
  id,
  direction: z.enum(MESSAGE_DIRECTIONS),
  channel: z.enum(MESSAGE_CHANNELS),
  purpose: z.enum(MESSAGE_PURPOSES),
  status: z.enum(MESSAGE_STATUSES),
  /** Email only. */
  subject: z.string().nullable(),
  body: z.string(),
  blockedReason: z.string().nullable(),
  provider: z.string(),
  createdAt: isoDate,
});
export type MessageItem = z.infer<typeof messageItem>;

/** An email in the development outbox (no email service connected yet). */
export interface OutboxEmail {
  id: string;
  to: string;
  subject: string | null;
  body: string;
  status: z.infer<typeof messageItem>["status"];
  blockedReason: string | null;
  createdAt: string;
}

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

/* ----------------------------------------------------------------------------
 * Money on a job: quotes (module 6, C-45) and payments (module 7, C-15, C-26)
 * ------------------------------------------------------------------------- */

export const quoteLine = z.object({
  id,
  serviceId: z.string().nullable(),
  description: z.string(),
  quantity: z.number().int(),
  /** Null until the owner prices a line that isn't on their price list. */
  unitPriceCents: z.number().int().nullable(),
  /** The AI wasn't sure or the line has no price yet: the owner looks at it before sending (C-45). */
  flagged: z.boolean(),
  flagReason: z.string().nullable(),
  origin: z.enum(QUOTE_LINE_ORIGINS),
});
export type QuoteLine = z.infer<typeof quoteLine>;

export const quoteSummary = z.object({
  id,
  leadId: id,
  /** "Q-1004". */
  number: z.string(),
  status: z.enum(QUOTE_STATUSES),
  revision: z.number().int(),
  title: z.string(),
  totalCents: z.number().int(),
  depositCents: z.number().int().nullable(),
  lineCount: z.number().int(),
  flaggedCount: z.number().int(),
  /** The customer's link, once the quote has been sent. */
  url: z.string().nullable(),
  sentAt: isoDate.nullable(),
  viewedAt: isoDate.nullable(),
  acceptedAt: isoDate.nullable(),
  declinedAt: isoDate.nullable(),
  validUntil: isoDate.nullable(),
  updatedAt: isoDate,
});
export type QuoteSummary = z.infer<typeof quoteSummary>;

export const paymentItem = z.object({
  id,
  leadId: id,
  quoteId: z.string().nullable(),
  kind: z.enum(PAYMENT_KINDS),
  capture: z.enum(PAYMENT_CAPTURES),
  status: z.enum(PAYMENT_STATUSES),
  amountCents: z.number().int(),
  description: z.string(),
  method: z.enum(PAYMENT_METHODS).nullable(),
  /** "Visa •••• 4242": brand and last four digits only. Card numbers never reach LeadAnchor. */
  card: z.string().nullable(),
  /** The customer's pay link; null for money the owner recorded by hand. */
  url: z.string().nullable(),
  heldAt: isoDate.nullable(),
  holdExpiresAt: isoDate.nullable(),
  paidAt: isoDate.nullable(),
  releasedAt: isoDate.nullable(),
  canceledAt: isoDate.nullable(),
  lastFailure: z.string().nullable(),
  /** The customer said they paid another way (Zelle or Venmo); the owner confirms it arrived. */
  reported: z.object({ method: z.enum(MANUAL_PAYMENT_METHODS), at: isoDate }).nullable(),
  note: z.string().nullable(),
  receiptSentAt: isoDate.nullable(),
  viewedAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type PaymentItem = z.infer<typeof paymentItem>;

export const leadBalance = z.object({
  /** The accepted (or latest sent) quote's total, else the job value the owner set. */
  jobValueCents: z.number().int().nullable(),
  paidCents: z.number().int(),
  /** On customers' cards, not collected yet (C-15). */
  heldCents: z.number().int(),
  /** Still to collect, counting holds as covered; null while the job has no price. */
  dueCents: z.number().int().nullable(),
});
export type LeadBalance = z.infer<typeof leadBalance>;

/** A booked visit (module 8): one slot on the business's day. */
export const bookingItem = z.object({
  id,
  leadId: id,
  service: z.object({ id, name: z.string() }).nullable(),
  startsAt: isoDate,
  endsAt: isoDate,
  status: z.enum(BOOKING_STATUSES),
  source: z.enum(BOOKING_SOURCES),
  /** The customer replied YES to the reminder. */
  confirmedAt: isoDate.nullable(),
  confirmationSentAt: isoDate.nullable(),
  reminderSentAt: isoDate.nullable(),
  canceledAt: isoDate.nullable(),
  canceledBy: z.enum(BOOKING_CANCELERS).nullable(),
  cancelReason: z.string().nullable(),
  /** Something in the owner's calendar clashes with it, in plain words. */
  calendarConflict: z.string().nullable(),
  /** The customer's page to change or cancel it. */
  manageUrl: z.string().nullable(),
  /** They asked to hear if an earlier time opens up (C-22). */
  wantsEarlier: z.boolean(),
  createdAt: isoDate,
});
export type BookingItem = z.infer<typeof bookingItem>;

export const leadDetail = leadCard.extend({
  lostReason: z.string().nullable(),
  events: z.array(leadEvent),
  calls: z.array(callItem),
  messages: z.array(messageItem),
  media: z.array(mediaItem),
  otherLeads: z.array(leadCard.pick({ id: true, title: true, stage: true, createdAt: true, valueCents: true })),
  intakeUrl: z.string().nullable(),
  quotes: z.array(quoteSummary),
  payments: z.array(paymentItem),
  balance: leadBalance,
  /** The upcoming visit, or the latest one when none is coming up. */
  booking: bookingItem.nullable(),
});
export type LeadDetail = z.infer<typeof leadDetail>;

/** A job tag: short, single-spaced. */
export const tagName = z
  .string()
  .trim()
  .min(1, "Enter a tag")
  .max(24, "Keep tags under 24 characters")
  .transform((value) => value.replace(/\s+/g, " "));

export const leadUpdateInput = z.object({
  stage: z.enum(LEAD_STAGES).optional(),
  position: z.number().optional(),
  title: z.string().trim().min(1).max(140).optional(),
  valueDollars: z.number().min(0).max(1_000_000).nullable().optional(),
  lostReason: z.string().trim().max(200).nullable().optional(),
  customerName: z.string().trim().max(80).optional(),
  scheduledFor: z.iso.datetime({ offset: true }).nullable().optional(),
  tags: z.array(tagName).max(MAX_TAGS_PER_JOB, `Up to ${MAX_TAGS_PER_JOB} tags per job`).optional(),
});
export type LeadUpdateInput = z.infer<typeof leadUpdateInput>;

/** Tags in use across the business, most used first, plus starter ideas (module 4). */
export const tagsResponse = z.object({
  tags: z.array(z.object({ name: z.string(), count: z.number().int() })),
  suggestions: z.array(z.string()),
});
export type TagsResponse = z.infer<typeof tagsResponse>;

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
  tags: z.array(z.string()),
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
    /** Money actually received (cards collected and payments the owner recorded). */
    paidCents: z.number().int(),
  }),
  jobs: z.array(customerJob),
  quotes: z.array(quoteSummary),
  payments: z.array(paymentItem),
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
  /** Optional: for the quote and receipt (and email offers, which anyone can unsubscribe from). */
  email: z.union([z.literal(""), z.email("Check the email address").max(120)]).optional().default(""),
  preferredTime: z.string().trim().max(120).optional().default(""),
  /** The plain-language "text me about this request" checkbox (feeds the consent ledger, C-27). */
  smsConsent: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "on"),
  /** A separate, unticked-by-default box for marketing texts; never bundled with the one above (C-27). */
  marketingConsent: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "on"),
});
export type IntakeSubmitFields = z.input<typeof intakeSubmitFields>;

/** A new request from the business's public form (C-10). We don't know the caller yet, so the phone is asked. */
export const publicRequestFields = intakeSubmitFields.extend({
  phone: usPhone,
  source: z.enum(REQUEST_SOURCES).catch("link"),
  /** Spam trap: hidden from people, filled in by bots. */
  company: z.string().max(200).optional().default(""),
});

/** Exact wording shown next to the checkbox — versioned so the ledger proves what was agreed to. */
export const INTAKE_CONSENT_TEXT =
  "Text me about this request. Messages are about this job only; reply STOP to opt out. Msg & data rates may apply.";
export const INTAKE_CONSENT_VERSION = "intake-form-v1";

/** Wording of the separate marketing box (TCPA express written consent), versioned for the ledger. */
export const intakeMarketingConsentText = (businessName: string) =>
  `Also text me offers and seasonal reminders from ${businessName}. Optional, not needed to get service. Up to 4 msgs/month; reply STOP to cancel. Msg & data rates may apply.`;
export const INTAKE_MARKETING_CONSENT_VERSION = "intake-marketing-v1";

/* ----------------------------------------------------------------------------
 * Settings & compliance (C-01, C-27, C-43)
 * ------------------------------------------------------------------------- */

export const settingsResponse = z.object({
  businessName: z.string(),
  trade: z.enum(TRADES),
  ownerName: z.string().nullable(),
  ownerCell: z.string().nullable(),
  /** Mailing address: printed in review emails (US anti-spam law) and kept on the Google listing. */
  streetAddress: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  timezone: z.string(),
  licenseNumber: z.string().nullable(),
  insuranceCarrier: z.string().nullable(),
  insurancePolicyNumber: z.string().nullable(),
  yearsInBusiness: z.number().int().nullable(),
  googleProfileUrl: z.string().nullable(),
  profileLinkInTexts: z.boolean(),
  /** The public profile page (C-41). */
  profileUrl: z.string(),
  /** The public request form behind the website button and the Google profile link (C-10). */
  requestUrl: z.string(),
  avgJobValueCents: z.number().int(),
  ringTimeoutSecs: z.number().int(),
  dispatcherEnabled: z.boolean(),
  valueProofFrequency: z.enum(["daily", "weekly", "off"]),
  trackingNumber: z.string().nullable(),
  forwardingStatus: z.enum(FORWARDING_STATUSES),
  forwardingCheckedAt: isoDate.nullable(),
  /** True while calls run on the built-in simulator instead of Telnyx. */
  simulated: z.boolean(),
});
export type SettingsResponse = z.infer<typeof settingsResponse>;

/** Start a forwarding test; `simulate` only applies on the call simulator. */
export const forwardingCheckInput = z.object({ simulate: z.enum(["forwards", "no_forward"]).optional() }).default({});

export const settingsUpdateInput = z.object({
  businessName: z.string().trim().min(2).max(80).optional(),
  ownerName: z.string().trim().min(2).max(80).optional(),
  ownerCell: usPhone.optional(),
  streetAddress: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(2).optional(),
  postalCode: z
    .union([z.literal(""), z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a valid ZIP code")])
    .nullable()
    .optional(),
  timezone: z.string().trim().min(3).optional(),
  licenseNumber: z.string().trim().max(40).nullable().optional(),
  insuranceCarrier: z.string().trim().max(80).nullable().optional(),
  insurancePolicyNumber: z.string().trim().max(60).nullable().optional(),
  yearsInBusiness: z.number().int().min(0).max(150).nullable().optional(),
  googleProfileUrl: z.url("Paste the full link, starting with https://").max(300).nullable().optional(),
  profileLinkInTexts: z.boolean().optional(),
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

/* ----------------------------------------------------------------------------
 * Phone alerts (C-05)
 * ------------------------------------------------------------------------- */

export const pushDeviceInput = z.object({
  /** Firebase registration token. Omitted on the simulator, which issues its own. */
  token: z.string().trim().min(10).max(4096).optional(),
  label: z.string().trim().min(1).max(80),
});
export type PushDeviceInput = z.infer<typeof pushDeviceInput>;

export const pushDevice = z.object({
  id,
  label: z.string(),
  /** Matches the token this browser keeps, so it can tell which row is itself. */
  token: z.string(),
  createdAt: isoDate,
  lastAlertAt: isoDate.nullable(),
});
export type PushDevice = z.infer<typeof pushDevice>;

export const pushDevicesResponse = z.object({
  provider: z.enum(PUSH_PROVIDERS),
  devices: z.array(pushDevice),
});
export type PushDevicesResponse = z.infer<typeof pushDevicesResponse>;

/** Simulator only: what the pretend carriers decide. Ignored when a real registry is connected. */
const simulate = z.enum(REGISTRY_TEST_OUTCOMES).optional();

export const registrationInput = z.discriminatedUnion("path", [
  z.object({
    path: z.literal("standard"),
    legalName: z.string().trim().min(2, "Enter the exact legal name on your IRS records").max(100),
    ein: z.string().trim().regex(/^\d{2}-?\d{7}$/, "EIN looks like 12-3456789"),
    entityType: z.enum(["PRIVATE_PROFIT", "PUBLIC_PROFIT", "NON_PROFIT"]),
    website: z.string().trim().max(200).optional().default(""),
    contactName: z.string().trim().min(2).max(80),
    contactEmail: z.email("Enter a valid email"),
    contactPhone: usPhone,
    ...address,
    simulate,
  }),
  z.object({
    path: z.literal("sole_proprietor"),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    mobile: usPhone,
    email: z.email("Enter a valid email"),
    ...address,
    simulate,
  }),
]);
export type RegistrationInput = z.input<typeof registrationInput>;

/** The one-time code the carriers text a sole proprietor's mobile. */
export const registrationCodeInput = z.object({
  code: z.string().trim().regex(/^\d{4,10}$/, "Enter the code from the text"),
});

export const registrationResponse = z.object({
  path: z.enum(REGISTRATION_PATHS).nullable(),
  status: z.enum(REGISTRATION_STATUSES),
  statusCopy: z.string(),
  /** The step the review is on, or the step that failed. */
  stage: z.enum(REGISTRATION_STAGES).nullable(),
  /** What to fix, in plain words, when the carriers turned something down. */
  statusReason: z.string().nullable(),
  displayName: z.string().nullable(),
  maskedTaxId: z.string().nullable(),
  /** Sole proprietors: last 4 digits of the mobile the code went to. */
  mobileLast4: z.string().nullable(),
  submittedAt: isoDate.nullable(),
  approvedAt: isoDate.nullable(),
  /** Retention: when the full tax ID / date of birth were deleted, or are due to be. */
  idDeletedAt: isoDate.nullable(),
  idDeleteAfter: isoDate.nullable(),
  smsEnabled: z.boolean(),
  /** The local registry simulator is standing in for the carriers. */
  simulated: z.boolean(),
  /** Non-sensitive details to pre-fill the form when the business details need a fix. */
  prefill: z.record(z.string(), z.string()).nullable(),
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
 * Quotes and payments: owner actions (modules 6 and 7)
 * ------------------------------------------------------------------------- */

const MAX_DOLLARS = MAX_PAYMENT_CENTS / 100;
const dollars = z.number().min(0).max(MAX_DOLLARS, "Up to $50,000");
const amountDollars = z.number().min(1, "At least $1").max(MAX_DOLLARS, "Up to $50,000");

export const quoteDetail = quoteSummary.extend({
  notes: z.string().nullable(),
  depositCapture: z.enum(PAYMENT_CAPTURES),
  lines: z.array(quoteLine),
  declineReason: z.string().nullable(),
  draft: z.object({
    source: z.enum(QUOTE_DRAFT_SOURCES),
    model: z.string().nullable(),
    ms: z.number().int().nullable(),
    photos: z.number().int(),
    /** Why the AI didn't write it, in plain words (e.g. its daily limit). */
    note: z.string().nullable(),
  }),
  customer: z.object({ name: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable() }),
  /** Card payments are on, so a deposit can be held on the customer's card. */
  cardPayments: z.boolean(),
});
export type QuoteDetail = z.infer<typeof quoteDetail>;

export const quoteLineInput = z.object({
  /** An existing line's id, so edits show up as changes rather than a new line. */
  id: z.string().optional(),
  serviceId: z.string().nullable().optional(),
  description: z.string().trim().min(1, "Describe this line").max(200),
  quantity: z.number().int().min(1, "At least 1").max(999),
  unitPriceDollars: dollars.nullable(),
  flagged: z.boolean().optional(),
  flagReason: z.string().trim().max(200).nullable().optional(),
  origin: z.enum(QUOTE_LINE_ORIGINS).optional(),
});
export type QuoteLineInput = z.infer<typeof quoteLineInput>;

export const quoteUpdateInput = z.object({
  title: z.string().trim().min(2, "Give the quote a title").max(120).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(quoteLineInput).max(MAX_QUOTE_LINES, `Up to ${MAX_QUOTE_LINES} lines`).optional(),
  depositDollars: amountDollars.nullable().optional(),
  depositCapture: z.enum(PAYMENT_CAPTURES).optional(),
});
export type QuoteUpdateInput = z.infer<typeof quoteUpdateInput>;

/** How something goes to the customer: a text, an email, or both (each through the governed send path). */
export const sendInput = z.object({
  text: z.boolean().default(true),
  email: z.email("Enter a valid email address").max(200).nullable().optional(),
});
export type SendInput = z.input<typeof sendInput>;

export const quoteSendResult = z.object({
  quote: quoteDetail,
  messages: z.array(messageItem),
});
export type QuoteSendResult = z.infer<typeof quoteSendResult>;

export const paymentRequestInput = z.object({
  kind: z.enum(PAYMENT_KINDS).default("payment"),
  amountDollars,
  description: z.string().trim().min(2, "Say what it's for").max(120),
  capture: z.enum(PAYMENT_CAPTURES).default("charge"),
  /** Collect this job's card holds at the same time, so the customer only pays the rest. */
  collectHeld: z.boolean().default(false),
  send: sendInput.default({ text: true }),
});
export type PaymentRequestInput = z.input<typeof paymentRequestInput>;

export const paymentRequestResult = z.object({
  payment: paymentItem,
  messages: z.array(messageItem),
});
export type PaymentRequestResult = z.infer<typeof paymentRequestResult>;

export const paymentRecordInput = z.object({
  amountDollars: z.number().min(0.01, "Enter the amount").max(MAX_DOLLARS, "Up to $50,000"),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  note: z.string().trim().max(200).nullable().optional(),
  /** The pay link this settles, e.g. one the customer said they paid by Zelle. */
  requestId: z.string().optional(),
});
export type PaymentRecordInput = z.input<typeof paymentRecordInput>;

export const paymentSettings = z.object({
  provider: z.enum(PAYMENT_PROVIDERS),
  status: z.enum(PAYMENT_ACCOUNT_STATUSES),
  /** Customers can pay by card (the business's payments account is set up). */
  cardPayments: z.boolean(),
  payouts: z.boolean(),
  /** What the payments provider still needs from the owner, in plain words. */
  requirements: z.array(z.string()),
  zelle: z.string().nullable(),
  venmo: z.string().nullable(),
  simulated: z.boolean(),
});
export type PaymentSettings = z.infer<typeof paymentSettings>;

const zelleContact = z
  .string()
  .trim()
  .max(120)
  .transform((value, ctx) => {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value.toLowerCase();
    const e164 = toE164(value);
    if (e164) return e164;
    ctx.addIssue({ code: "custom", message: "Enter the email or US mobile number your Zelle uses" });
    return z.NEVER;
  });

export const paymentSettingsInput = z.object({
  zelle: zelleContact.nullable().optional(),
  venmo: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z0-9_-]{5,30}$/, "Enter your Venmo username, like @demo-plumbing")
    .transform((value) => value.replace(/^@/, ""))
    .nullable()
    .optional(),
});
export type PaymentSettingsInput = z.input<typeof paymentSettingsInput>;

/* ----------------------------------------------------------------------------
 * Quotes and pay links: the customer's side (no login, the link is the key)
 * ------------------------------------------------------------------------- */

export const publicBusiness = z.object({
  name: z.string(),
  trade: z.enum(TRADES),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  licenseNumber: z.string().nullable(),
  insuranceCarrier: z.string().nullable(),
  yearsInBusiness: z.number().int().nullable(),
  profileUrl: z.string(),
});
export type PublicBusiness = z.infer<typeof publicBusiness>;

/** open: waiting for an answer; updating: the owner is changing it; expired: past its date. */
export const PUBLIC_QUOTE_STATES = ["open", "updating", "accepted", "declined", "expired"] as const;
export type PublicQuoteState = (typeof PUBLIC_QUOTE_STATES)[number];

export const publicQuote = z.object({
  business: publicBusiness,
  number: z.string(),
  state: z.enum(PUBLIC_QUOTE_STATES),
  title: z.string(),
  customerName: z.string().nullable(),
  lines: z.array(z.object({ description: z.string(), quantity: z.number().int(), unitPriceCents: z.number().int(), totalCents: z.number().int() })),
  totalCents: z.number().int(),
  depositCents: z.number().int().nullable(),
  depositCapture: z.enum(PAYMENT_CAPTURES),
  /** The deposit can be paid by card here; otherwise the business arranges it. */
  cardPayments: z.boolean(),
  notes: z.string().nullable(),
  issuedAt: isoDate,
  validUntil: isoDate,
  acceptedAt: isoDate.nullable(),
  declinedAt: isoDate.nullable(),
  /** Once accepted with a deposit: its pay link and where it stands. */
  deposit: z.object({ url: z.string(), status: z.enum(PAYMENT_STATUSES) }).nullable(),
  pdfUrl: z.string(),
});
export type PublicQuote = z.infer<typeof publicQuote>;

export const quoteAcceptResult = z.object({
  /** Where to go next: the card checkout for the deposit, or null when there's nothing to pay now. */
  checkoutUrl: z.string().nullable(),
  quote: publicQuote,
});
export type QuoteAcceptResult = z.infer<typeof quoteAcceptResult>;

export const quoteDeclineInput = z.object({ reason: z.string().trim().max(300).optional().default("") });

export const publicPayment = z.object({
  business: publicBusiness,
  customerName: z.string().nullable(),
  kind: z.enum(PAYMENT_KINDS),
  capture: z.enum(PAYMENT_CAPTURES),
  status: z.enum(PAYMENT_STATUSES),
  amountCents: z.number().int(),
  description: z.string(),
  method: z.enum(PAYMENT_METHODS).nullable(),
  card: z.string().nullable(),
  heldAt: isoDate.nullable(),
  holdExpiresAt: isoDate.nullable(),
  paidAt: isoDate.nullable(),
  /** "R-7F3A9C2D": quoted on the receipt. */
  receiptNumber: z.string(),
  cardPayments: z.boolean(),
  zelle: z.string().nullable(),
  venmo: z.string().nullable(),
  reported: z.object({ method: z.enum(MANUAL_PAYMENT_METHODS), at: isoDate }).nullable(),
  lastFailure: z.string().nullable(),
  /** Card payments run on the simulator: no real money moves. */
  simulated: z.boolean(),
});
export type PublicPayment = z.infer<typeof publicPayment>;

export const paymentReportInput = z.object({ method: z.enum(["zelle", "venmo"]) });

/* ----------------------------------------------------------------------------
 * Booking (module 8, C-17 … C-22): availability, self-booking, reminders, waitlist
 * ------------------------------------------------------------------------- */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-02");

export const dayHours = z
  .object({ open: z.boolean(), start: hhmm, end: hhmm })
  .refine((hours) => !hours.open || hours.start < hours.end, { message: "Closing time must be after opening time", path: ["end"] });

export const bookingSettings = z.object({
  /** Customers can book online (the booking link and the website button's Book option). */
  enabled: z.boolean(),
  hours: z.object(Object.fromEntries(WEEKDAY_KEYS.map((key) => [key, dayHours])) as Record<(typeof WEEKDAY_KEYS)[number], typeof dayHours>),
  /** Start times offered every this many minutes. */
  stepMins: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  /** Nothing can be booked closer than this to now. */
  noticeHours: z.number().int().min(0).max(72),
  /** How far ahead customers can book. */
  windowDays: z.number().int().min(1).max(60),
  /** Kept free after each job, e.g. to drive to the next one. */
  bufferMins: z.number().int().min(0).max(120),
});
export type BookingSettings = z.infer<typeof bookingSettings>;

/** Weekdays 8 to 5 to start with; trades get half an hour between jobs for the drive. */
export function defaultBookingSettings(track: Track): BookingSettings {
  const weekday = { open: true, start: "08:00", end: "17:00" };
  const closed = { open: false, start: "09:00", end: "13:00" };
  return {
    enabled: false,
    hours: { sun: closed, mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: closed },
    stepMins: 30,
    noticeHours: 2,
    windowDays: 14,
    bufferMins: track === "A" ? 30 : 0,
  };
}

export const calendarStatus = z.object({
  provider: z.enum(CALENDAR_PROVIDERS).nullable(),
  connected: z.boolean(),
  /** The calendar's name or account, as the provider shows it. */
  account: z.string().nullable(),
  lastSyncedAt: isoDate.nullable(),
  error: z.string().nullable(),
  /** Google and Microsoft aren't set up yet, so the simulator stands in. */
  simulated: z.boolean(),
});
export type CalendarStatus = z.infer<typeof calendarStatus>;

export const bookingSettingsResponse = z.object({
  settings: bookingSettings,
  timezone: z.string(),
  /** The public booking page: share it, or paste it into the Google profile as the booking link. */
  bookingUrl: z.string(),
  calendar: calendarStatus,
  /** Services with no time on the price list use an hour. */
  servicesWithoutTime: z.number().int(),
});
export type BookingSettingsResponse = z.infer<typeof bookingSettingsResponse>;

export const slotsResponse = z.object({
  serviceId: z.string(),
  durationMins: z.number().int(),
  timezone: z.string(),
  days: z.array(z.object({ date: day, slots: z.array(isoDate) })),
});
export type SlotsResponse = z.infer<typeof slotsResponse>;

export const publicBookingContext = z.object({
  business: publicBusiness,
  enabled: z.boolean(),
  timezone: z.string(),
  services: z.array(
    z.object({
      id,
      name: z.string(),
      description: z.string().nullable(),
      durationMins: z.number().int(),
      priceCents: z.number().int().nullable(),
    }),
  ),
  /** For jobs that need a look first: the request form instead. */
  requestUrl: z.string(),
});
export type PublicBookingContext = z.infer<typeof publicBookingContext>;

export const BOOKING_CONSENT_TEXT =
  "Text me about this booking: a confirmation, a reminder the day before and any changes. Reply STOP to opt out. Msg & data rates may apply.";
export const BOOKING_CONSENT_VERSION = "booking-v1";

/** C-22: its own box, separate from the booking texts, so the waitlist opt-in is explicit. */
export const waitlistConsentText = (businessName: string) =>
  `If an earlier time opens up, ${businessName} may text me so I can take it. Optional; reply STOP to opt out.`;
export const WAITLIST_CONSENT_VERSION = "waitlist-v1";

const customerFields = {
  name: z.string().trim().min(2, "Enter your name").max(80),
  phone: usPhone,
  email: z.union([z.literal(""), z.email("Enter a valid email address").max(200)]).optional().default(""),
  /** Hidden from people; only bots fill it in. */
  company: z.string().max(200).optional().default(""),
};

export const bookingInput = z.object({
  serviceId: z.string(),
  startsAt: isoDate,
  ...customerFields,
  notes: z.string().trim().max(500).optional().default(""),
  smsConsent: z.boolean().default(false),
  /** Wants a text if an earlier time opens up (C-22). */
  earlier: z.boolean().default(false),
  source: z.enum(REQUEST_SOURCES).catch("link"),
});
export type BookingInput = z.input<typeof bookingInput>;

export const publicBooking = z.object({
  business: publicBusiness,
  status: z.enum(BOOKING_STATUSES),
  service: z.object({ name: z.string(), durationMins: z.number().int() }),
  startsAt: isoDate,
  endsAt: isoDate,
  timezone: z.string(),
  customerName: z.string().nullable(),
  confirmedAt: isoDate.nullable(),
  canceledAt: isoDate.nullable(),
  /** Changes are allowed until the business's notice time before the visit. */
  canChange: z.boolean(),
  serviceId: z.string().nullable(),
  wantsEarlier: z.boolean(),
  /** Where to book again after a cancellation. */
  bookingUrl: z.string(),
});
export type PublicBooking = z.infer<typeof publicBooking>;

export const bookingCreated = z.object({ manageUrl: z.string(), booking: publicBooking });
export type BookingCreated = z.infer<typeof bookingCreated>;

export const rescheduleInput = z.object({ startsAt: isoDate });
export const cancelBookingInput = z.object({ reason: z.string().trim().max(300).optional().default("") });

export const waitlistJoinInput = z.object({
  serviceId: z.string(),
  from: day,
  to: day,
  ...customerFields,
  smsConsent: z.boolean().default(false),
  source: z.enum(REQUEST_SOURCES).catch("link"),
});
export type WaitlistJoinInput = z.input<typeof waitlistJoinInput>;

/** A freed slot offered to someone on the waitlist; the first to say yes gets it (C-22). */
export const publicOffer = z.object({
  business: publicBusiness,
  state: z.enum(["open", "yours", "taken", "expired"]),
  service: z.object({ name: z.string(), durationMins: z.number().int() }),
  startsAt: isoDate,
  endsAt: isoDate,
  timezone: z.string(),
  customerName: z.string().nullable(),
  /** After taking it: their booking page. */
  manageUrl: z.string().nullable(),
  /** Already booked for later: taking this moves that booking here. */
  replaces: isoDate.nullable(),
});
export type PublicOffer = z.infer<typeof publicOffer>;

/** The owner books or moves a visit. Overlaps are refused unless the owner says to go ahead. */
export const ownerBookingInput = z.object({
  startsAt: isoDate,
  serviceId: z.string().nullable().optional(),
  durationMins: z.number().int().min(15).max(12 * 60).optional(),
  allowOverlap: z.boolean().default(false),
  /** Text the customer a confirmation. */
  notify: z.boolean().default(true),
});
export type OwnerBookingInput = z.input<typeof ownerBookingInput>;

export const ownerCancelInput = z.object({
  reason: z.string().trim().max(300).optional().default(""),
  /** Tell the customer it's cancelled. */
  notify: z.boolean().default(true),
});

/** Module 8 "non-attendance handling". */
export const noShowInput = z.object({
  /** Collect the deposit held on their card (C-15). */
  keepDeposit: z.boolean().default(false),
  /** Text them a link to book again. */
  sendRebookLink: z.boolean().default(false),
});

export const waitlistItem = z.object({
  id,
  customer: z.object({ id, name: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable() }),
  service: z.object({ id, name: z.string() }).nullable(),
  from: isoDate,
  to: isoDate,
  /** Already booked; wants an earlier time. */
  bookedFor: isoDate.nullable(),
  textsAllowed: z.boolean(),
  status: z.enum(WAITLIST_STATUSES),
  lastOfferedAt: isoDate.nullable(),
  leadId: z.string().nullable(),
  createdAt: isoDate,
});
export type WaitlistItem = z.infer<typeof waitlistItem>;

export const simCalendarEvent = z.object({
  id,
  title: z.string(),
  startsAt: isoDate,
  endsAt: isoDate,
  /** Made by LeadAnchor for a booking. */
  fromLeadAnchor: z.boolean(),
});
export type SimCalendarEvent = z.infer<typeof simCalendarEvent>;

export const simCalendarEventInput = z.object({
  title: z.string().trim().min(1, "Give it a title").max(80),
  startsAt: isoDate,
  endsAt: isoDate,
});

/* ----------------------------------------------------------------------------
 * Reviews and the Google listing (module 9, C-21, C-23, C-46, C-47)
 * ------------------------------------------------------------------------- */

export const listingStatus = z.object({
  provider: z.enum(LISTING_PROVIDERS).nullable(),
  connected: z.boolean(),
  /** The listing's name as Google shows it. */
  locationName: z.string().nullable(),
  rating: z.number().nullable(),
  reviewCount: z.number().int(),
  /** Where customers write a review: the link in every review request. */
  reviewUrl: z.string().nullable(),
  listingUrl: z.string().nullable(),
  lastSyncedAt: isoDate.nullable(),
  lastPushedAt: isoDate.nullable(),
  error: z.string().nullable(),
  /** Google isn't set up yet, so a simulator stands in. */
  simulated: z.boolean(),
});
export type ListingStatus = z.infer<typeof listingStatus>;

/** A Google post: an update published to the listing (module 9 "content publication"). */
export const listingPost = z.object({
  id,
  text: z.string(),
  status: z.enum(["posted", "failed"]),
  error: z.string().nullable(),
  createdAt: isoDate,
});
export type ListingPost = z.infer<typeof listingPost>;

const syncFields = z.object({
  hours: z.boolean(),
  phone: z.boolean(),
  website: z.boolean(),
  bookingLink: z.boolean(),
  address: z.boolean(),
});

export const listingResponse = z.object({
  listing: listingStatus,
  replyTone: z.enum(REPLY_TONES),
  /** Which fields LeadAnchor keeps up to date on Google; the owner can turn each off. */
  syncFields,
  /** What those fields will be set to, from the business's own settings (C-21). */
  pushes: z.object({
    hours: z.array(z.object({ day: z.string(), hours: z.string() })),
    phone: z.string().nullable(),
    website: z.string(),
    bookingLink: z.string(),
    bookingLinkIs: z.enum(["booking", "request"]),
    /** Null until the street address and ZIP are filled in. */
    address: z.string().nullable(),
  }),
  posts: z.array(listingPost),
});
export type ListingResponse = z.infer<typeof listingResponse>;

export const listingSettingsInput = z.object({
  replyTone: z.enum(REPLY_TONES).optional(),
  syncFields: syncFields.partial().optional(),
});
export const listingPostInput = z.object({
  text: z.string().trim().min(1, "Write something").max(1500, "Google allows up to 1,500 characters"),
});

export const reviewItem = z.object({
  id,
  reviewer: z.string(),
  rating: z.number().int().min(1).max(5),
  text: z.string().nullable(),
  publishedAt: isoDate,
  reply: z.object({ text: z.string(), postedAt: isoDate }).nullable(),
  /** The AI's draft (C-47), waiting for the owner. */
  draft: z.string().nullable(),
  replyStatus: z.enum(REVIEW_REPLY_STATUSES),
  replyError: z.string().nullable(),
  showOnProfile: z.boolean(),
  /** The job it's about, when the reviewer matches a customer of a completed job. */
  job: z.object({ leadId: id, title: z.string() }).nullable(),
});
export type ReviewItem = z.infer<typeof reviewItem>;

export const reviewRequestItem = z.object({
  id,
  leadId: id,
  customerName: z.string().nullable(),
  jobTitle: z.string(),
  outcome: z.enum(REVIEW_REQUEST_OUTCOMES),
  /** Why it couldn't go, in plain words. */
  detail: z.string().nullable(),
  sendAt: isoDate,
  /** The customer used the private link. */
  feedbackAt: isoDate.nullable(),
});
export type ReviewRequestItem = z.infer<typeof reviewRequestItem>;

export const reviewsResponse = z.object({
  listing: listingStatus,
  reviews: z.array(reviewItem),
  stats: z.object({
    average: z.number().nullable(),
    count: z.number().int(),
    needReply: z.number().int(),
    newThisWeek: z.number().int(),
  }),
  requests: z.object({
    /** Jobs marked Won in the last 90 days, and how many got a request: these always match (C-46 AC 7). */
    completedJobs: z.number().int(),
    requested: z.number().int(),
    sent: z.number().int(),
    recent: z.array(reviewRequestItem),
  }),
  /** The Google link review requests use right now; null when there's none. */
  reviewLink: z.string().nullable(),
  /** The postal address printed in review emails (US anti-spam law); null when it's missing. */
  postalAddress: z.string().nullable(),
});
export type ReviewsResponse = z.infer<typeof reviewsResponse>;

export const reviewsSummary = z.object({
  connected: z.boolean(),
  rating: z.number().nullable(),
  count: z.number().int(),
  needReply: z.number().int(),
  newThisWeek: z.number().int(),
});
export type ReviewsSummary = z.infer<typeof reviewsSummary>;

export const reviewReplyInput = z.object({ text: z.string().trim().min(1, "Write a reply").max(4000) });
export const reviewPatchInput = z.object({ showOnProfile: z.boolean() });

/** The private line in the review request (C-46): the customer tells the owner directly. */
export const publicFeedbackContext = z.object({
  business: publicBusiness,
  firstName: z.string().nullable(),
  /** They already sent something; they can send more. */
  sent: z.boolean(),
});
export type PublicFeedbackContext = z.infer<typeof publicFeedbackContext>;

export const privateFeedbackInput = z.object({
  message: z.string().trim().min(2, "Tell them what happened").max(2000),
  /** Hidden from people; only bots fill it in. */
  company: z.string().max(200).optional().default(""),
});

/** The unsubscribe page for marketing-type emails such as review requests (CAN-SPAM). */
export const publicUnsubscribe = z.object({
  businessName: z.string(),
  /** Masked: j***@example.com. */
  email: z.string(),
  unsubscribed: z.boolean(),
});
export type PublicUnsubscribe = z.infer<typeof publicUnsubscribe>;

/* ----------------------------------------------------------------------------
 * Simulated Google listing (development only): the business's page and "write a review"
 * ------------------------------------------------------------------------- */

export const simGoogleListing = z.object({
  account: z.string(),
  name: z.string(),
  rating: z.number().nullable(),
  reviewCount: z.number().int(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  bookingLink: z.string().nullable(),
  hours: z.array(z.object({ day: z.string(), hours: z.string() })),
  reviews: z.array(
    z.object({
      id: z.string(),
      reviewer: z.string(),
      rating: z.number().int(),
      text: z.string().nullable(),
      publishedAt: isoDate,
      reply: z.object({ text: z.string(), updatedAt: isoDate }).nullable(),
    }),
  ),
  posts: z.array(z.object({ id: z.string(), text: z.string(), createdAt: isoDate })),
  /** The next reply the business posts is refused, to try the retry and error path (C-47 AC 6). */
  failNextReply: z.boolean(),
});
export type SimGoogleListing = z.infer<typeof simGoogleListing>;

export const simGoogleReviewInput = z.object({
  reviewer: z.string().trim().min(2, "Enter your name").max(60),
  rating: z.number().int().min(1, "Pick a rating").max(5),
  text: z.string().trim().max(4000).optional().default(""),
});

/* ----------------------------------------------------------------------------
 * Simulated Stripe pages (development only): hosted checkout and account setup
 * ------------------------------------------------------------------------- */

export const simCheckout = z.object({
  id,
  businessName: z.string(),
  description: z.string(),
  amountCents: z.number().int(),
  capture: z.enum(PAYMENT_CAPTURES),
  status: z.enum(["open", "complete", "expired"]),
  lastFailure: z.string().nullable(),
});
export type SimCheckout = z.infer<typeof simCheckout>;

export const simCheckoutInput = z.object({ outcome: z.enum(["pay", "decline", "cancel"]) });

export const simOnboarding = z.object({
  id,
  businessName: z.string(),
  status: z.enum(["onboarding", "active", "restricted"]),
});
export type SimOnboarding = z.infer<typeof simOnboarding>;

export const simOnboardingInput = z.object({ outcome: z.enum(["finish", "later"]) });

/** Where the simulated Stripe page sends the browser next. */
export const simRedirect = z.object({ redirectUrl: z.string() });
export type SimRedirect = z.infer<typeof simRedirect>;

/* ----------------------------------------------------------------------------
 * Local call simulator (development only)
 * ------------------------------------------------------------------------- */

export const simulatorScenarioInput = z.object({
  callerPhone: usPhone,
  callerName: z.string().trim().max(80).optional(),
  ownerBehavior: z.enum(["no_answer", "answers", "carrier_voicemail"]),
  callerBehavior: z.enum(["hangs_up_while_ringing", "talks_to_dispatcher", "hangs_up_during_greeting"]),
  utterance: z.string().trim().max(500).optional().default(""),
  /** How the caller answers "can we text you?": by voice, or by pressing 1 on the keypad (C-06). */
  consent: z.enum(["yes", "no", "press1"]).default("yes"),
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
