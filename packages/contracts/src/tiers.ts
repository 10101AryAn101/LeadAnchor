/**
 * LeadAnchor's own subscription: what a business pays LeadAnchor each month (the Excel's tier key).
 * Called tiers here because "plans" are the maintenance plans a business sells its own customers.
 */
export const TIERS = ["starter", "pro", "growth"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_DETAILS: Record<
  Tier,
  { name: string; priceCents: number; pitch: string; includes: string[] }
> = {
  starter: {
    name: "Starter",
    priceCents: 4_500,
    pitch: "Catch every call and get paid.",
    includes: [
      "Missed calls caught and texted a request link",
      "AI greeting for new callers",
      "Request forms with photos",
      "Lead board and customer history",
      "Deposits and payment links",
      "Google listing kept up to date",
      "Pass extra jobs to trusted pros",
      "Review requests",
    ],
  },
  pro: {
    name: "Pro",
    priceCents: 10_500,
    pitch: "Fill your calendar without lifting a finger.",
    includes: [
      "Everything in Starter",
      "An AI assistant that answers chats and texts",
      "Online booking, reminders and a waitlist",
      "Campaigns and win-backs",
      "Photo-to-quote and AI review replies",
      "Referral credits off your bill",
      "Full reports",
      "Found when customers ask AI",
    ],
  },
  growth: {
    name: "Growth",
    priceCents: 19_900,
    pitch: "Recurring income from your own maintenance plans.",
    includes: [
      "Everything in Pro",
      "Your own maintenance plans",
      "Members charged automatically every month",
    ],
  },
};

/** C-33, the add-on on any tier: a one-page website and a tuned Google listing (the Excel: $149 one-time + $5/mo). */
export const WEBSITE_ADDON = {
  name: "Website + Google listing",
  setupCents: 14_900,
  monthlyCents: 500,
  includes: [
    "A one-page website built from your LeadAnchor details: services, photos, reviews, hours",
    "Call, text and WhatsApp buttons that stay on screen, and your chat on every page",
    "Your Google listing's website and chat links point to it",
    "It updates itself as jobs and reviews come in. No editing needed",
  ],
} as const;

/** Where the website add-on stands. */
export const WEBSITE_STATUSES = ["none", "active", "past_due", "cancelled"] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

/** The parts of the app a tier unlocks. Starter's features are open to every business, so they aren't listed. */
export const FEATURES = [
  "assistant",
  "online_booking",
  "campaigns",
  "ai_quotes",
  "review_replies",
  "referral_credits",
  "reports",
  "ai_discovery",
  "memberships",
] as const;
export type Feature = (typeof FEATURES)[number];

/** The lowest tier that includes each feature (the Excel's Tier column: C-16, C-18..C-22, C-25, C-28..C-31, C-42, C-45, C-47, C-48..C-52). */
export const FEATURE_TIER: Record<Feature, Tier> = {
  assistant: "pro",
  online_booking: "pro",
  campaigns: "pro",
  ai_quotes: "pro",
  review_replies: "pro",
  referral_credits: "pro",
  reports: "pro",
  ai_discovery: "pro",
  memberships: "growth",
};

/** Each reads as one thing, so "… is part of Pro" works for every feature. */
export const FEATURE_LABELS: Record<Feature, string> = {
  assistant: "The AI chat assistant",
  online_booking: "Online booking",
  campaigns: "Sending campaigns",
  ai_quotes: "Photo-to-quote",
  review_replies: "Drafting review replies with AI",
  referral_credits: "Earning referral credits",
  reports: "Full reporting",
  ai_discovery: "Getting found by AI",
  memberships: "Selling maintenance plans",
};

export const tierAllows = (tier: Tier | null, feature: Feature) =>
  tier !== null && TIERS.indexOf(tier) >= TIERS.indexOf(FEATURE_TIER[feature]);

/** Every new business tries everything, Growth included, for this long. */
export const TRIAL_DAYS = 14;

/**
 * Stripe needs a trial's end at least two days out: a tier chosen with that much trial left is first
 * charged when the trial ends; with less left, billing starts straight away.
 */
export const MIN_TRIAL_LEFT_MS = 48 * 3_600_000;

/** Where a business stands with LeadAnchor (the tenant's status column). */
export const ACCOUNT_STATUSES = ["trial", "active", "past_due", "suspended", "cancelled"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/**
 * The tier a business can use right now. A trial gets everything; a paid tier gets what it pays for,
 * also while a card retry is pending (past due). An ended trial, a cancelled or a suspended account gets
 * no paid tier: calls are still caught (Starter's features never switch off), but tier features pause.
 */
export function accessTier(
  account: {
    status: AccountStatus;
    tier: Tier | null;
    trialEndsAt: Date | string | null;
    isDemo?: boolean;
  },
  now = new Date(),
): Tier | null {
  if (account.isDemo) return "growth";
  if (account.status === "trial") {
    return account.trialEndsAt && new Date(account.trialEndsAt).getTime() > now.getTime()
      ? "growth"
      : null;
  }
  if (account.status === "active" || account.status === "past_due")
    return account.tier ?? "starter";
  return null;
}

/** Whole days left in a trial, rounding up so the last day reads "1 day left". */
export const trialDaysLeft = (trialEndsAt: Date | string | null, now = new Date()) =>
  trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - now.getTime()) / 86_400_000))
    : 0;
