import type { Trade } from "@leadanchor/contracts";
import { TRADE_NOUN } from "./ai-profile";

/** A check asks this many questions. */
export const PANEL_SIZE = 10;

/** Ten questions a customer near the business might ask an AI assistant (C-42 point 6). */
export function panelQuestions(input: { trade: Trade; city: string | null; state: string | null; zip: string | null; services: string[] }) {
  const place = input.city && input.state ? `${input.city}, ${input.state}` : (input.state ?? "my area");
  const noun = TRADE_NOUN[input.trade];
  const near = input.zip ? `near ${input.zip}` : `in ${place}`;
  const questions = [
    `Who is the best ${noun} in ${place}?`,
    `I need a ${noun} ${near}. Who should I call?`,
    `Can you recommend a licensed and insured ${noun} in ${place}?`,
    `Which ${noun} in ${place} has the best reviews?`,
    ...input.services.slice(0, 4).map((service) => `Who can do ${service.toLowerCase()} in ${place}?`),
    `Is there a ${noun} ${near} who can come today?`,
    `Who's a reliable, fairly priced ${noun} in ${place}?`,
    `Which local ${noun} do people in ${place} trust?`,
    `Who do you recommend for ${noun} work ${near}?`,
    `Which ${noun} would you hire in ${place}?`,
    `Who is a top-rated ${noun} ${near}?`,
  ];
  return [...new Set(questions)].slice(0, PANEL_SIZE);
}

/** "Rivera Plumbing & Heating, LLC" and "rivera plumbing and heating" are the same name. */
export const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(llc|inc|co|corp|company|ltd|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Whether an answer names the business: any named business that matches, or the name in the text. */
export function mentions(businessName: string, named: string[], answer: string) {
  const target = normalizeName(businessName);
  if (!target) return false;
  return (
    named.some((name) => {
      const other = normalizeName(name);
      return other.includes(target) || (other.length >= 6 && target.includes(other));
    }) || normalizeName(answer).includes(target)
  );
}
