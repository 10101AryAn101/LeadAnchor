import { REFERRALS_PER_FREE_MONTH, type ReferralKind, TIER_DETAILS } from "@leadanchor/contracts";
import { and, count, eq, isNull } from "drizzle-orm";
import { billing } from "../../container";
import { systemDb } from "../../db/client";
import { referralConversions, referralCredits, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { logger } from "../../lib/logger";
import { realtime } from "../../lib/realtime";
import { featureOn } from "../billing/access";
import { audit } from "../compliance/audit";
import { notifyOwner } from "../notifications/notify";

/**
 * C-25: a referral turned into business (a passed job the partner won, or a business that joined
 * with the link and subscribed). It counts toward a free month while the plan includes referral
 * credits; every REFERRALS_PER_FREE_MONTH that count earn one. Counting twice is harmless.
 */
export async function recordReferral(earnerId: string, kind: ReferralKind, sourceId: string) {
  const [earner] = await systemDb
    .select({ status: tenants.status, tier: tenants.tier, trialEndsAt: tenants.trialEndsAt, isDemo: tenants.isDemo })
    .from(tenants)
    .where(eq(tenants.id, earnerId));
  if (!earner) return;
  const counted = featureOn(earner, "referral_credits");

  const earned = await tenantWork(earnerId, async (tx, fx) => {
    const [row] = await tx
      .insert(referralConversions)
      .values({ tenantId: earnerId, kind, sourceId, counted })
      .onConflictDoNothing()
      .returning({ id: referralConversions.id });
    if (!row) return false;
    fx.publish({ type: "network.updated" });
    if (!counted) return false;
    const [total] = await tx
      .select({ value: count() })
      .from(referralConversions)
      .where(and(eq(referralConversions.tenantId, earnerId), eq(referralConversions.counted, true)));
    if ((total?.value ?? 0) % REFERRALS_PER_FREE_MONTH !== 0) return false;

    const [credit] = await tx.insert(referralCredits).values({ tenantId: earnerId }).returning({ id: referralCredits.id });
    await audit(tx, {
      tenantId: earnerId,
      actor: "system",
      action: "referral.credit_earned",
      entityType: "referral_credit",
      entityId: credit!.id,
      data: { conversions: total?.value ?? 0, kind, sourceId },
    });
    await notifyOwner(tx, fx, {
      tenantId: earnerId,
      kind: "network",
      title: "You earned a free month",
      body: `${REFERRALS_PER_FREE_MONTH} of your referrals turned into business, so a month of LeadAnchor is on us.`,
      path: "/network",
    });
    return true;
  });
  if (earned) await applyReferralCredits(earnerId);
}

/**
 * Puts earned free months on the bill: one month of the tier the business pays for, taken off its
 * next invoices. Waits until there's a paid plan to take them off (on the trial there's no bill yet).
 */
export async function applyReferralCredits(tenantId: string) {
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant?.billingCustomerId || !tenant.tier || (tenant.status !== "active" && tenant.status !== "past_due")) return;
  const waiting = await systemDb
    .select({ id: referralCredits.id })
    .from(referralCredits)
    .where(and(eq(referralCredits.tenantId, tenantId), isNull(referralCredits.appliedAt)));
  for (const credit of waiting) {
    const cents = TIER_DETAILS[tenant.tier].priceCents;
    try {
      // The credit's id keys the request, so a retry never adds the month twice.
      await billing.addCredit(tenant.billingCustomerId, cents, "Free month for referrals", `referral-credit:${credit.id}`);
      await systemDb.update(referralCredits).set({ amountCents: cents, appliedAt: new Date() }).where(eq(referralCredits.id, credit.id));
    } catch (error) {
      logger.error({ err: error, tenantId, creditId: credit.id }, "referral credit not applied");
    }
  }
  if (waiting.length > 0) realtime.publish(tenantId, { type: "account.updated" });
}
