import { PRICE_MOVE_NOTICE_DAYS, planPrice } from "@leadanchor/contracts";
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { payments } from "../../container";
import { systemDb } from "../../db/client";
import { membershipPlans, paymentAccounts, planMemberships } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { HttpError, notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { addDays } from "../../lib/time";
import { audit } from "../compliance/audit";
import { cardsReady } from "../payments/payment.service";
import { applySubscriptionState, dayOf, partyOf, tellMember } from "./billing";
import { manageUrl } from "./links";
import { firstRenewalOnOrAfter } from "./renewals";
import { ensurePrice } from "./plans.service";

const STILL_BILLED = ["active", "past_due", "paused"] as const;

/**
 * C-48 AC 2: the owner moves the members who kept an older price to the plan's current one.
 * Nobody is re-priced silently: each member is told now, keeps their price for at least
 * 30 days, and the new price starts at the first renewal after that. They can cancel before.
 * Members on another billing schedule (monthly against yearly) keep theirs; the owner can
 * move them one by one with "Change plan".
 */
export async function moveMembersToPlanPrice(tenantId: string, planId: string, actor: string) {
  const now = new Date();
  const notBefore = addDays(now, PRICE_MOVE_NOTICE_DAYS);
  return tenantWork(tenantId, async (tx, fx) => {
    const [plan] = await tx
      .select()
      .from(membershipPlans)
      .where(eq(membershipPlans.id, planId))
      .for("update");
    if (!plan) throw notFound("Plan");
    const priceId = await ensurePrice(tx, plan);
    if (!priceId) throw new HttpError(409, "not_billing", "Card payments aren't set up.");
    const members = await tx
      .select()
      .from(planMemberships)
      .where(
        and(
          eq(planMemberships.planId, planId),
          inArray(planMemberships.status, [...STILL_BILLED]),
          isNotNull(planMemberships.providerSubscriptionId),
          isNull(planMemberships.pendingPriceAt),
          ne(planMemberships.priceCents, plan.priceCents),
        ),
      );
    const moving = members.filter((member) => member.interval === plan.interval);
    for (const member of moving) {
      const at = firstRenewalOnOrAfter(member.currentPeriodEnd, member.interval, notBefore);
      await tx
        .update(planMemberships)
        .set({
          pendingPriceCents: plan.priceCents,
          pendingPriceId: priceId,
          pendingPriceAt: at,
          priceNoticeAt: now,
        })
        .where(eq(planMemberships.id, member.id));
      const party = await partyOf(tx, member);
      await tellMember(tx, fx, party, `Your ${plan.name} price is changing`, [
        `From ${dayOf(at, party.tenant.timezone)}, your ${plan.name} will be ${planPrice(plan.priceCents, plan.interval)}. It's ${planPrice(member.priceCents, member.interval)} now, and nothing changes before then.`,
        `If you'd rather not carry on at the new price, you can cancel any time before then and won't be charged it: ${manageUrl(member.id)}`,
      ]);
    }
    await audit(tx, {
      tenantId,
      actor,
      action: "plan.members_moving",
      entityType: "membership_plan",
      entityId: planId,
      data: {
        priceCents: plan.priceCents,
        moving: moving.length,
        otherSchedule: members.length - moving.length,
        noticeDays: PRICE_MOVE_NOTICE_DAYS,
      },
    });
    fx.publish({ type: "membership.updated", membershipId: planId });
    return { moving: moving.length, otherSchedule: members.length - moving.length };
  });
}

/**
 * Every 15 minutes: an announced move takes effect once the member's current period is the
 * last one at the old price. The switch never bills anything now; the next renewal bills the new
 * price. A member who cancelled in the meantime just has the move dropped.
 */
export async function applyDuePriceMoves() {
  const due = await systemDb
    .select({ membership: planMemberships, account: paymentAccounts })
    .from(planMemberships)
    .innerJoin(paymentAccounts, eq(paymentAccounts.tenantId, planMemberships.tenantId))
    .where(isNotNull(planMemberships.pendingPriceId));
  let moved = 0;
  for (const { membership, account } of due) {
    const tenantId = membership.tenantId;
    const clear = { pendingPriceCents: null, pendingPriceId: null, pendingPriceAt: null };
    if (!STILL_BILLED.includes(membership.status as (typeof STILL_BILLED)[number])) {
      await tenantWork(tenantId, (tx) =>
        tx.update(planMemberships).set(clear).where(eq(planMemberships.id, membership.id)),
      );
      continue;
    }
    // Still renewals at the old price to come: not yet.
    const lastOld =
      membership.currentPeriodEnd &&
      membership.pendingPriceAt &&
      membership.currentPeriodEnd.getTime() >= membership.pendingPriceAt.getTime() - 3_600_000;
    if (!lastOld || !membership.providerSubscriptionId || !cardsReady(account)) continue;
    try {
      const { subscription } = await payments.changeSubscriptionPrice(
        account.providerAccountId,
        membership.providerSubscriptionId,
        membership.pendingPriceId!,
        { prorate: false },
      );
      await tenantWork(tenantId, async (tx) => {
        await tx.update(planMemberships).set(clear).where(eq(planMemberships.id, membership.id));
        await audit(tx, {
          tenantId,
          actor: "system",
          action: "membership.price_moved",
          entityType: "membership",
          entityId: membership.id,
          data: {
            from: membership.priceCents,
            to: membership.pendingPriceCents,
            fromRenewal: membership.pendingPriceAt?.toISOString() ?? null,
          },
        });
      });
      await applySubscriptionState(tenantId, subscription);
      moved += 1;
    } catch (error) {
      logger.warn(
        { err: error, membershipId: membership.id },
        "price move not applied; tried again later",
      );
    }
  }
  return { moved };
}
