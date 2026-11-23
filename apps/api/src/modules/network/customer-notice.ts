/**
 * C-24 guardrail 1, no silent transfer: a job only moves to another pro when the customer can be
 * told who has it. These are the send path's own answers (would the text go? would the email go?),
 * turned into how they'll hear, or why they can't.
 */
export type CustomerNotice =
  { via: "text" | "email"; problem: null } | { via: null; problem: string };

export function customerNotice(
  /** The send path's decision for a text to their number; null when there's no number. */
  text: { allowed: boolean; reason: string | null } | null,
  /** Why an email to them would be blocked (null when it would go); undefined when there's no email. */
  emailBlocked: string | null | undefined,
): CustomerNotice {
  if (text?.allowed) return { via: "text", problem: null };
  if (emailBlocked === null) return { via: "email", problem: null };
  const textPart = text
    ? clause(text.reason ?? "Texts can't reach them.")
    : "there's no phone number for them";
  const emailPart =
    emailBlocked === undefined ? "there's no email address for them" : clause(emailBlocked);
  return { via: null, problem: `${textPart}, and ${emailPart}` };
}

/** "Texting is blocked until …." becomes "texting is blocked until …", to sit inside a sentence. Names like WhatsApp stay. */
function clause(reason: string) {
  const first = reason.split(/(?<=\.)\s/)[0]!.replace(/\.$/, "");
  const word = first.match(/^[A-Za-z]+/)?.[0] ?? "";
  return /^[A-Z][a-z]+$/.test(word) ? first[0]!.toLowerCase() + first.slice(1) : first;
}
