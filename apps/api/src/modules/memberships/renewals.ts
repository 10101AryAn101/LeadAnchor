import type { PlanInterval } from "@leadanchor/contracts";

/** The first renewal on or after `notBefore`, stepping on from the current period's end. */
export function firstRenewalOnOrAfter(
  periodEnd: Date | null,
  interval: PlanInterval,
  notBefore: Date,
): Date {
  if (!periodEnd) return notBefore;
  const next = new Date(periodEnd);
  for (let guard = 0; guard < 60 && next < notBefore; guard++) {
    if (interval === "year") next.setUTCFullYear(next.getUTCFullYear() + 1);
    else next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}
