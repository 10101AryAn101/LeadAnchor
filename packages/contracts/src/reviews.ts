/**
 * C-46: the review request. One message after every completed job, carrying BOTH links: the
 * Google review link and a private line to the owner. The wording is the approved copy, kept
 * here and not editable in the app; any change to it must pass `reviewCopyLint` (a test runs it).
 */
export const REVIEW_REQUEST_COPY =
  "Hi {first_name}, thanks for choosing {business}! We'd love your feedback. Leave us a public review on Google here: {gbp_link}  Or, if you had any issues today, please text us directly here so our owner can fix it immediately: {private_chat_link}";

export const REVIEW_REQUEST_SUBJECT = "Thanks for choosing {business}";

/** The request as sent: the approved words, the two links on their own lines so they're easy to tap. */
export function reviewRequestMessage(input: {
  firstName: string | null;
  business: string;
  googleLink: string;
  privateLink: string;
}) {
  const body = REVIEW_REQUEST_COPY.replace("{first_name}", input.firstName?.trim() || "there")
    .replace("{business}", input.business)
    .replace("{gbp_link}", `\n${input.googleLink}\n\n`)
    .replace("  Or,", "Or,")
    .replace("{private_chat_link}", `\n${input.privateLink}`);
  return { subject: REVIEW_REQUEST_SUBJECT.replace("{business}", input.business), body };
}

interface Rule {
  pattern: RegExp;
  problem: string;
}

/** Anything of value in return: Google bans incentives even for honest reviews (C-46 AC 4, C-47 AC 2). */
const INCENTIVES: Rule[] = [
  {
    pattern:
      /\b(discount|coupon|voucher|gift ?cards?|rewards?|prizes?|raffle|giveaway|sweepstakes|cash ?back|rebate)\b/i,
    problem: "offers something in return",
  },
  {
    pattern:
      /\b\d+ ?% ?off\b|\$ ?\d+(\.\d+)? ?off\b|\bfor free\b|\bfree (gift|service|visit|inspection|month|estimate|check-?up|tune-?up)\b|\b(chance|entry|entered) to win\b|\bin (exchange|return) for\b/i,
    problem: "offers something in return",
  },
];

/** Asking only happy customers, or steering the rating, is review gating (C-46 AC 1, 2). */
const GATING: Rule[] = [
  {
    pattern:
      /\b(5|five)[ -]?stars?\b|\brate us\b|\b(if|when) you('re| are| were) (happy|satisfied|pleased)\b|\bonly if\b|\b(happy|satisfied) customers?\b|\bhow (would you )?rate\b/i,
    problem: "steers who reviews or what they rate",
  },
];

/** The private line is extra, never a way around the public review (C-46 AC 3). */
const DIVERSION: Rule[] = [
  {
    pattern:
      /\binstead of\b|\brather than\b|\bbefore (you )?(leave|leaving|post|posting|write|writing)\b|\b(don'?t|do not) (leave|post|write)\b|\bno need to (leave|post|write)\b/i,
    problem: "discourages a public review",
  },
];

function lint(text: string, rules: Rule[]) {
  const problems: string[] = [];
  for (const rule of rules) {
    const match = text.match(rule.pattern);
    if (match) problems.push(`“${match[0]}” ${rule.problem}`);
  }
  return problems;
}

/** Checks review-request wording: no incentives, no gating, nothing that discourages a review. */
export const reviewCopyLint = (text: string) =>
  lint(text, [...INCENTIVES, ...GATING, ...DIVERSION]);

/** Checks a reply to a review (C-47 AC 2): it may thank and explain, but never offer anything. */
export const replyLint = (text: string) => lint(text, INCENTIVES);
