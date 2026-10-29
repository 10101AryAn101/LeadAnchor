/**
 * The shared vocabulary of LeadAnchor. Every status, stage and source used by
 * the API, the database and the UI comes from here, so the three never drift.
 *
 * Capability IDs (C-xx) refer to the "Capabilities" sheet of
 * Revenue_Automation_OS_Capabilities v2.xlsx.
 */

/** Trades we onboard. Track A = blue collar (unpredictable jobs, triage + photos); Track B = predictable appointments. */
export const TRADES = [
  "plumbing",
  "electrical",
  "hvac",
  "roofing",
  "handyman",
  "landscaping",
  "salon",
  "grooming",
  "spa",
  "auto",
  "other",
] as const;
export type Trade = (typeof TRADES)[number];

export const TRACKS = ["A", "B"] as const;
export type Track = (typeof TRACKS)[number];

export const TRACK_BY_TRADE: Record<Trade, Track> = {
  plumbing: "A",
  electrical: "A",
  hvac: "A",
  roofing: "A",
  handyman: "A",
  landscaping: "A",
  salon: "B",
  grooming: "B",
  spa: "B",
  auto: "B",
  other: "A",
};

export const TRADE_LABELS: Record<Trade, string> = {
  plumbing: "Plumbing",
  electrical: "Electrical",
  hvac: "Heating & cooling",
  roofing: "Roofing",
  handyman: "Handyman",
  landscaping: "Landscaping",
  salon: "Salon",
  grooming: "Pet grooming",
  spa: "Spa",
  auto: "Auto service",
  other: "Other",
};

export const ROLES = ["owner", "manager", "technician"] as const;
export type Role = (typeof ROLES)[number];

/** Lead board columns (C-12). */
export const LEAD_STAGES = ["new", "contacted", "quoted", "scheduled", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  scheduled: "Scheduled",
  won: "Won",
  lost: "Lost",
};

/**
 * What the owner did that moves a card by itself: reaching the customer (Contacted),
 * adding a price (Quoted) or booking a visit (Scheduled). Won and Lost always need the
 * owner's word, so nothing moves a card there automatically.
 */
export const AUTO_MOVE_REASONS = ["owner_called", "owner_texted", "owner_answered", "form_sent", "price_set", "visit_booked"] as const;
export type AutoMoveReason = (typeof AUTO_MOVE_REASONS)[number];

export const AUTO_MOVE_STAGE: Record<AutoMoveReason, LeadStage> = {
  owner_called: "contacted",
  owner_texted: "contacted",
  owner_answered: "contacted",
  form_sent: "contacted",
  price_set: "quoted",
  visit_booked: "scheduled",
};

/** The stage a card moves to after `reason`, or null when it stays put. Cards only ever move forward. */
export function autoMoveTarget(current: LeadStage, reason: AutoMoveReason): LeadStage | null {
  if (current === "won" || current === "lost") return null;
  const target = AUTO_MOVE_STAGE[reason];
  return LEAD_STAGES.indexOf(target) > LEAD_STAGES.indexOf(current) ? target : null;
}

/** The "is my call forwarding on?" test (C-01): a call to the owner's cell that should come back to the LeadAnchor line. */
export const FORWARDING_STATUSES = ["unknown", "checking", "verified", "not_detected"] as const;
export type ForwardingStatus = (typeof FORWARDING_STATUSES)[number];

/** How the owner reached out from a card: the Call or Text button. */
export const CONTACT_CHANNELS = ["call", "text"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/** Where a lead came from. A "ghost lead" is a missed_call lead where the caller hung up before leaving anything (C-05). */
export const LEAD_SOURCES = [
  "missed_call",
  "voicemail",
  "ai_dispatcher",
  "web_form",
  "whatsapp",
  "google",
  "manual",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  missed_call: "Missed call",
  voicemail: "Voicemail",
  ai_dispatcher: "AI Dispatcher",
  web_form: "Website form",
  whatsapp: "WhatsApp",
  google: "Google",
  manual: "Added by you",
};

export const URGENCY_LEVELS = ["low", "normal", "high", "emergency"] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

/** Where a request on the public form came from (C-10): the website button, the Google profile, or a shared link. */
export const REQUEST_SOURCES = ["website", "google", "link"] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

/** How the customer's request form is progressing (C-07 / C-08). */
export const INTAKE_STATUSES = ["none", "link_sent", "opened", "submitted"] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

/** Final outcome of an inbound call (C-03 … C-06, C-39). */
export const CALL_OUTCOMES = [
  "in_progress",
  "answered",
  "ghost",
  "voicemail",
  "dispatcher_completed",
  "dispatcher_abandoned",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  in_progress: "In progress",
  answered: "Answered by you",
  ghost: "Hung up — callback needed",
  voicemail: "Voicemail",
  dispatcher_completed: "AI Dispatcher",
  dispatcher_abandoned: "Hung up during greeting",
};

export const CALLER_TYPES = ["new", "known"] as const;
export type CallerType = (typeof CALLER_TYPES)[number];

/** Messaging (Module 5 — one governed send path). */
export const MESSAGE_CHANNELS = ["sms", "rcs", "whatsapp", "email"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/** keyword_reply: the one-off answer to a customer's own STOP, START or HELP, which carriers require. */
export const MESSAGE_PURPOSES = ["transactional", "conversational", "marketing", "keyword_reply"] as const;
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];

export const MESSAGE_DIRECTIONS = ["outbound", "inbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_STATUSES = ["queued", "blocked", "sent", "delivered", "failed", "received"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Consent ledger (C-27). Each entry is immutable; a revocation is a new entry. */
export const CONSENT_TYPES = ["sms_transactional", "sms_marketing", "voice_marketing", "email_marketing"] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const CONSENT_ACTIONS = ["GRANTED", "REVOKED"] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

export const CONSENT_SOURCES = ["voice_ack", "ivr_dtmf", "web_form", "inbound_message", "stop_keyword", "owner_action"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/** Carrier registration (A2P 10DLC, C-43). */
export const REGISTRATION_PATHS = ["standard", "sole_proprietor"] as const;
export type RegistrationPath = (typeof REGISTRATION_PATHS)[number];

export const REGISTRATION_STATUSES = ["not_started", "submitted", "verify_mobile", "in_review", "approved", "rejected"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const REGISTRATION_STATUS_COPY: Record<RegistrationStatus, string> = {
  not_started: "Not started — texting customers is switched off until carriers approve you.",
  submitted: "Submitted — we're sending your details to the carriers.",
  verify_mobile: "Check your phone — enter the code the carriers texted you to confirm your mobile number.",
  in_review: "Carrier approval: in review — usually 1–3 weeks.",
  approved: "Approved — automatic texts are on.",
  rejected: "Needs a fix — the carriers asked us to correct something.",
};

/** The review runs in order: the business is checked, then the texting plan, then the number is connected. */
export const REGISTRATION_STAGES = ["brand", "campaign", "number"] as const;
export type RegistrationStage = (typeof REGISTRATION_STAGES)[number];

/** Simulator only: what the pretend carriers decide (like the `mock` brands Telnyx offers for testing). */
export const REGISTRY_TEST_OUTCOMES = ["approve", "reject_brand", "reject_campaign"] as const;
export type RegistryTestOutcome = (typeof REGISTRY_TEST_OUTCOMES)[number];

/** Retention (C-43): the full EIN and date of birth are deleted this many days after approval. */
export const REGISTRATION_ID_RETENTION_DAYS = 30;

export const NOTIFICATION_KINDS = [
  "ghost_call",
  "voicemail",
  "dispatcher_lead",
  "intake_submitted",
  "photo_analyzed",
  "value_proof",
  "registration",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Job tags (module 4) offered before a business has made its own. */
export const STARTER_TAGS: Record<Track, string[]> = {
  A: ["Emergency", "Warranty", "Commercial", "Repeat customer", "Needs parts", "Estimate only"],
  B: ["New client", "Regular", "VIP", "Package", "Follow up"],
};
export const MAX_TAGS_PER_JOB = 8;

/** Phone alerts (C-05): Firebase Cloud Messaging, or the local simulator until Firebase is connected. */
export const PUSH_PROVIDERS = ["fcm", "simulator"] as const;
export type PushProviderName = (typeof PUSH_PROVIDERS)[number];

/** What happened to an alert's push: none sent (no phones / in-app only), sent, failed, or simulated. */
export const PUSH_STATUSES = ["in_app", "fcm_sent", "fcm_failed", "simulated"] as const;
export type PushStatus = (typeof PUSH_STATUSES)[number];

/** Third-party services named in the spec, with how this build talks to each. */
export const INTEGRATIONS = [
  "telnyx",
  "carrier_registry",
  "whatsapp",
  "google_business_profile",
  "stripe",
  "firebase",
  "gemini",
  "scheduler",
  "email",
] as const;
export type IntegrationKey = (typeof INTEGRATIONS)[number];

export const INTEGRATION_STATES = ["live", "simulated", "not_configured", "planned"] as const;
export type IntegrationState = (typeof INTEGRATION_STATES)[number];
