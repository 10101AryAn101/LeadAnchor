/**
 * Everything the AI Dispatcher says (C-39). Rules from the spec:
 *  - always name the business, never claim to be a person;
 *  - ask one qualifying question;
 *  - ask for a spoken yes before texting, and keep the exact wording versioned (C-27).
 */

export const DISPATCHER_LISTEN_SECS = 20;
export const CONSENT_LISTEN_SECS = 8;
export const VOICEMAIL_MAX_SECS = 120;
/** Server-side ceiling for the whole AI conversation (C-39: hard stop at 60s). */
export const DISPATCHER_HARD_STOP_SECS = 60;

export const greeting = (business: string) =>
  `Hi, you've reached ${business}. Sorry we couldn't pick up — this is ${business}'s automated assistant. ` +
  `In a few words, what can we help you with today?`;

export const CONSENT_QUESTION =
  "Thanks. Can we text you a link at this number so you can send details and photos? " +
  "Message and data rates may apply. To agree, say yes or press 1. Otherwise, say no.";

export const goodbyeAfterYes = (business: string) =>
  `Great — the text is on its way. Someone from ${business} will be in touch soon. Goodbye!`;

export const goodbyeAfterNo = (business: string) =>
  `No problem. Someone from ${business} will call you back as soon as possible. Goodbye!`;

export const voicemailPrompt = (business: string, firstName: string | null) =>
  `Hi${firstName ? ` ${firstName}` : ""}, you've reached ${business}. Sorry we missed you — ` +
  `please leave a message after the tone and we'll call you right back.`;

// Word boundaries are Unicode-aware (\p{L}) so Spanish answers like "Sí" work.
const word = (alternatives: string) => new RegExp(`(?:^|[^\\p{L}'])(?:${alternatives})(?=$|[^\\p{L}'])`, "iu");
const YES = word("yes|yeah|yep|yup|sure|ok|okay|please|absolutely|of course|go ahead|sounds good|definitely|s[ií]");
const EXPLICIT_YES = word("yes|s[ií]");
// Negations and hedges: "not sure", "maybe", "don't" are never consent.
const NO = word("no|nope|nah|not|never|don't|dont|do not|stop|maybe|unsure");

/**
 * True only for a clear yes (C-27: consent must be unambiguous). A negation or hedge
 * cancels a soft yes ("not sure" → no), unless the caller also says "yes" outright.
 */
export function isAffirmative(answer: string) {
  const text = answer.trim();
  if (!text) return false;
  if (NO.test(text) && !EXPLICIT_YES.test(text)) return false;
  return YES.test(text);
}

export const firstNameOf = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] ?? null;
