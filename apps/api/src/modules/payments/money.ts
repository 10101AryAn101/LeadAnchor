import type { LeadBalance, PaymentStatus } from "@leadanchor/contracts";

/** Pure money helpers for quotes and payments. Everything is in whole cents. */

export const lineTotal = (line: { quantity: number; unitPriceCents: number | null }) =>
  line.unitPriceCents == null ? 0 : line.quantity * line.unitPriceCents;

export const quoteTotal = (lines: Array<{ quantity: number; unitPriceCents: number | null }>) =>
  lines.reduce((sum, line) => sum + lineTotal(line), 0);

export const toCents = (dollars: number) => Math.round(dollars * 100);

/** "Q-1004". */
export const quoteNumber = (number: number) => `Q-${number}`;

/** "R-7F3A9C2D": the random tail of the payment's id, quoted on receipts. */
export const receiptNumber = (paymentId: string) =>
  `R-${paymentId.replace(/-/g, "").slice(-8).toUpperCase()}`;

const BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
};

/** "Visa •••• 4242". */
export function cardLabel(brand: string | null, last4: string | null) {
  if (!brand || !last4) return null;
  return `${BRANDS[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1)} •••• ${last4}`;
}

/** "$1,250" or "$1,250.50": whole dollars unless there are cents. */
export function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * What has been paid on a job and what is still to collect. Holds count as covered: they are
 * collected with the final bill, so the customer is never asked for the same money twice.
 */
export function balanceOf(
  jobValueCents: number | null,
  payments: Array<{ status: PaymentStatus; amountCents: number }>,
): LeadBalance {
  const sum = (status: PaymentStatus) =>
    payments
      .filter((payment) => payment.status === status)
      .reduce((total, payment) => total + payment.amountCents, 0);
  const paidCents = sum("paid");
  const heldCents = sum("held");
  return {
    jobValueCents,
    paidCents,
    heldCents,
    dueCents: jobValueCents == null ? null : Math.max(0, jobValueCents - paidCents - heldCents),
  };
}

/** Which way a payment's status may move. Paid is final; money arriving after a cancel still counts. */
export function canMove(from: PaymentStatus, to: PaymentStatus) {
  if (from === to) return false;
  switch (to) {
    case "held":
      return from === "open";
    case "paid":
      return from !== "paid";
    case "released":
      return from === "held";
    case "canceled":
      return from === "open";
    case "open":
      return false;
  }
}
