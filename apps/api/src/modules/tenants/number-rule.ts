import type { tenants } from "../../db/schema";

type Tenant = typeof tenants.$inferSelect;

/** How long a business that left keeps its LeadAnchor number, in case it comes back. */
export const NUMBER_GRACE_DAYS = 30;

/**
 * A business has left once its plan is cancelled; it keeps its number for the grace period after
 * the plan ended. A trial that simply ran out isn't leaving (and demo businesses never leave).
 */
export function numberReleaseDue(
  tenant: Pick<Tenant, "status" | "isDemo" | "billingPeriodEnd" | "trialEndsAt" | "createdAt">,
  now = new Date(),
) {
  if (tenant.status !== "cancelled" || tenant.isDemo) return false;
  const ended = tenant.billingPeriodEnd ?? tenant.trialEndsAt ?? tenant.createdAt;
  return ended.getTime() <= now.getTime() - NUMBER_GRACE_DAYS * 86_400_000;
}
