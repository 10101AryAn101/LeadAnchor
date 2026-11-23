import type { RegistrationPath, RegistrationStage, Trade } from "@leadanchor/contracts";

/** TCR industry vertical for each trade. */
export const TRADE_VERTICAL: Record<Trade, string> = {
  plumbing: "CONSTRUCTION",
  electrical: "CONSTRUCTION",
  hvac: "CONSTRUCTION",
  roofing: "CONSTRUCTION",
  handyman: "CONSTRUCTION",
  landscaping: "CONSTRUCTION",
  salon: "PROFESSIONAL",
  grooming: "PROFESSIONAL",
  spa: "PROFESSIONAL",
  auto: "PROFESSIONAL",
  other: "PROFESSIONAL",
};

/**
 * Turns a registry's failure reason into what the owner should do next (C-43:
 * "status shown in plain words, never raw API states"). The raw reason goes to the audit trail.
 */
export function plainFailure(stage: RegistrationStage, raw: string | null): string {
  if (stage === "campaign") {
    return "Your business passed, but the carriers turned down the texting plan we filed for you. Your details don't need to change: send it again.";
  }
  if (stage === "number") {
    return "Your texting plan is approved, but your LeadAnchor number didn't connect to it. Send it again to retry.";
  }
  const text = (raw ?? "").toLowerCase();
  if (/\b(ein|tax|irs)\b/.test(text)) {
    return "The carriers couldn't match your EIN to your legal business name. Check both against your IRS letter (CP 575 or 147C), then send again.";
  }
  if (/address|zip|postal/.test(text)) {
    return "The carriers couldn't confirm your business address. Use the address on your IRS records, then send again.";
  }
  if (/otp|mobile|phone/.test(text)) {
    return "The carriers couldn't confirm your mobile number. Use a US mobile number that can receive texts, then send again.";
  }
  return "The carriers couldn't verify your details. Make sure they match your official paperwork exactly, then send again.";
}

/** Answers to a customer's own keywords. The carriers get these same words in the campaign filing. */
export function keywordReplies(businessName: string) {
  return {
    help: `${businessName}: for help, call us at this number. Msg & data rates may apply. Reply STOP to opt out.`,
    optIn: `${businessName}: You'll get texts about your request. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`,
    optOut: `${businessName}: You're unsubscribed and won't get more texts. Reply START to resubscribe.`,
  };
}

/**
 * What we file with the carriers about how this business texts. It has to match what
 * LeadAnchor actually sends and how customers agree to it, or the campaign is rejected.
 */
export function campaignContent(input: { businessName: string; path: RegistrationPath; webUrl: string }) {
  const name = input.businessName;
  const replies = keywordReplies(name);
  const privacyPolicyUrl = `${input.webUrl}/privacy`;
  const termsUrl = `${input.webUrl}/terms`;
  const samples = [
    `${name}: Sorry we missed your call! Tell us what you need and we'll get right back to you: ${input.webUrl}/i/3Gq9xT0bLmV2. Reply STOP to opt out.`,
    `${name}: You're booked for Tue between 2 and 4pm. Reply HELP for help or STOP to opt out.`,
  ];
  // Offers only go to customers who ticked the separate offers box; sole-proprietor campaigns don't cover them.
  if (input.path === "standard") samples.push(`${name}: Past customers get 15% off this month. Book here: ${input.webUrl}/i/3Gq9xT0bLmV2. Reply STOP to opt out.`);

  return {
    description: `${name} replies to customers who call or ask for service: missed-call follow-ups with a link to a request form, job and appointment updates, and, for customers who opt in separately, occasional offers.`,
    messageFlow:
      `Customers opt in one of two ways. (1) When they call ${name} and nobody answers, an automated assistant asks if they'd like a text with a request form; ` +
      `they agree by saying yes or pressing 1, and the time and wording are recorded. (2) On ${name}'s online request form they tick an unticked box; ` +
      `offers have their own separate box. Neither is needed to get service. Privacy policy: ${privacyPolicyUrl}. Terms: ${termsUrl}.`,
    samples,
    helpMessage: replies.help,
    optinMessage: replies.optIn,
    optoutMessage: replies.optOut,
    privacyPolicyUrl,
    termsUrl,
  };
}
