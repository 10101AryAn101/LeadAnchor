/**
 * The trusted pros network (C-24): a business that's too busy passes one job to a nearby pro, with
 * the customer told and able to stay. And referral credits (C-25): a free month of LeadAnchor for
 * every few referrals that turn into business.
 */

/** A passed job: offered to a few pros, taken by the first to accept. */
export const HANDOFF_STATUSES = ["offered", "accepted", "declined", "expired", "withdrawn"] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

/** One pro's copy of the offer. "closed" means someone else took it, or it ran out. */
export const HANDOFF_OFFER_STATUSES = ["pending", "accepted", "passed", "closed"] as const;
export type HandoffOfferStatus = (typeof HANDOFF_OFFER_STATUSES)[number];

/** How many pros hear about a job at once (the Excel: "pings ~3 available contractors"). */
export const HANDOFF_FANOUT = 3;
/** How long the pros have to accept before the job comes back to the business. */
export const HANDOFF_OFFER_HOURS = 2;
/** How long the customer can still choose to stay with the business that passed the job. */
export const HANDOFF_STAY_DAYS = 7;

/** Exactly what the pro who accepts receives (guardrail 2): never job history, never other customers. */
export const HANDOFF_SHARED_FIELDS = ["Name", "Phone number", "Job description", "Address"] as const;

/**
 * The partner terms a pro accepts before any job reaches them (guardrail 3). Change the version
 * whenever the words change: members then accept again before they get more jobs.
 */
export const NETWORK_TERMS_VERSION = "2026-11-03";
export const NETWORK_TERMS = [
  "I use a passed customer's details only to do that one job.",
  "I don't market to them, add them to any list, or pass their details on.",
  "If the customer chooses to stay with the business that passed the job, I stop and delete what I have.",
  "My licence and insurance statements on LeadAnchor are true.",
  "No money changes hands between pros for a passed job. The business that passes it may earn LeadAnchor credit.",
] as const;

/** C-25: one free month for every this many converted referrals. */
export const REFERRALS_PER_FREE_MONTH = 3;
/** A passed job the partner won, or a business that joined with the referral link and paid. */
export const REFERRAL_KINDS = ["handoff", "signup"] as const;
export type ReferralKind = (typeof REFERRAL_KINDS)[number];
