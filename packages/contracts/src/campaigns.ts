/**
 * Email campaigns (module 11, C-28 … C-30, C-44): the one merge field and the checks a campaign
 * passes before it can go out. The app shows the same problems while the owner types.
 */

/** The only merge field: the customer's first name. */
export const FIRST_NAME_FIELD = "{first_name}";

/**
 * Fills in {first_name}. With no name, the message says "there" ("Hi there,") and the subject
 * simply drops the field ("We'd love to help again, {first_name}" → "We'd love to help again").
 */
export function fillMergeFields(text: string, firstName: string | null, where: "subject" | "body") {
  const name = firstName?.trim();
  if (name) return text.replace(/\{first_name\}/gi, name);
  return where === "subject"
    ? text
        .replace(/[,\s]*\{first_name\}/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim()
    : text.replace(/\{first_name\}/gi, "there");
}

/**
 * What stops a campaign going out. CAN-SPAM forbids misleading subject lines, so no fake "Re:" or
 * "Fwd:"; the rest keeps it readable and out of spam folders.
 */
export function campaignProblems(input: { subject: string; body: string }): string[] {
  const problems: string[] = [];
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject) problems.push("Add a subject line.");
  if (/^(re|fwd?)\s*:/i.test(subject))
    problems.push(
      "Don't start the subject with “Re:” or “Fwd:”. It pretends to continue a conversation, which US anti-spam law forbids.",
    );
  if (subject.length > 100) problems.push("Shorten the subject to 100 characters or fewer.");
  const letters = subject.replace(/[^a-z]/gi, "");
  if (letters.length >= 6 && letters === letters.toUpperCase())
    problems.push("Write the subject in normal case. All capitals reads as spam.");
  const unknown = `${subject} ${body}`.match(/\{(?!first_name\})[^{}\s]{1,30}\}/i);
  if (unknown) problems.push(`Only ${FIRST_NAME_FIELD} can be filled in. Remove ${unknown[0]}.`);
  if (!body) problems.push("Write the message.");
  if (body.length > 3000) problems.push("Shorten the message to 3,000 characters or fewer.");
  return problems;
}
