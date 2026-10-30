import type { PlanInterval, WorkCadenceKind } from "./domain";

/**
 * Memberships (module 12): the wording customers agree to, and the rules both apps share.
 * The sign-up wording is versioned: the version is stored with every consent, so the record
 * shows exactly what each member agreed to (ROSCA, C-49 AC 1).
 */
export const MEMBERSHIP_CONSENT_VERSION = "membership-v1";

const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

/** "$99 a month" */
export const planPrice = (priceCents: number, interval: PlanInterval) =>
  `${usd(priceCents)} a ${interval}`;

/** What a plan is worth each month, for recurring income: a yearly plan counts a twelfth. */
export const monthlyCents = (priceCents: number, interval: PlanInterval) =>
  interval === "month" ? priceCents : Math.round(priceCents / 12);

/**
 * Shown in full before they pay (C-48 AC 3, C-49 AC 1): the price, how often, that it renews
 * until cancelled, and how to cancel. Plain words, no small print.
 */
export function membershipTerms(input: {
  business: string;
  priceCents: number;
  interval: PlanInterval;
}) {
  const every = input.interval === "month" ? "every month" : "every year";
  return [
    `You pay ${usd(input.priceCents)} today, then ${usd(input.priceCents)} ${every} until you cancel.`,
    "Cancel any time from the link in every receipt. It takes a minute online, with no phone call.",
    `If you cancel, you keep the plan until the end of the ${input.interval} you've paid for, and you're not charged again.`,
    `Your card is handled by Stripe. ${input.business} never sees your card number.`,
  ];
}

/** The box they tick (express informed consent, C-49 AC 1). */
export const membershipConsentText = (input: {
  business: string;
  priceCents: number;
  interval: PlanInterval;
}) =>
  `I agree that ${input.business} will charge my card ${usd(input.priceCents)} today and then ${
    input.interval === "month" ? "every month" : "every year"
  } until I cancel.`;

export interface WorkCadence {
  kind: WorkCadenceKind;
  /** "nth": every this many bills. */
  every: number;
  /** "months": only bills paid in these months (1 = January). */
  months: number[];
}

/**
 * C-51: does this paid bill put the plan's job on the board? `cycle` counts paid plan bills
 * from 1 (the sign-up); `month` is the month the bill was paid in.
 */
export function workDue(cadence: WorkCadence, cycle: number, month: number) {
  switch (cadence.kind) {
    case "every":
      return true;
    case "nth":
      return (cycle - 1) % Math.max(1, cadence.every) === 0;
    case "months":
      return cadence.months.includes(month);
    case "none":
      return false;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Every bill", "Every 3rd bill", "Bills in Mar and Sep", "No jobs" */
export function cadenceLabel(cadence: WorkCadence) {
  switch (cadence.kind) {
    case "every":
      return "Every bill";
    case "nth": {
      const n = cadence.every;
      const suffix = n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
      return `Every ${n}${suffix} bill`;
    }
    case "months":
      return cadence.months.length
        ? `Bills in ${[...cadence.months]
            .sort((a, b) => a - b)
            .map((month) => MONTHS[month - 1])
            .join(", ")}`
        : "No months picked";
    case "none":
      return "No jobs";
  }
}
