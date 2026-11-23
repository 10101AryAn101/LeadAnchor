import type { LeadDetail } from "@leadanchor/contracts";

/** What's still to collect and not already on an open pay link, so the same money isn't billed twice. */
export function unbilledCents(lead: Pick<LeadDetail, "balance" | "payments">) {
  const open = lead.payments
    .filter((payment) => payment.status === "open")
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  return Math.max(0, (lead.balance.dueCents ?? 0) - open);
}
