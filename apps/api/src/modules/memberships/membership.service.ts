import {
  type MembershipDetail,
  type MembershipItem,
  type MembershipsResponse,
  type membershipActionInput,
  monthlyCents,
  planPrice,
} from "@leadanchor/contracts";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { payments, simulatorPayments } from "../../container";
import { withTenant } from "../../db/client";
import {
  customers,
  membershipInvoices,
  membershipPlans,
  planMemberships,
  tenants,
} from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { PaymentRefused } from "../../integrations/payments/types";
import { HttpError, notFound } from "../../lib/errors";
import { iso } from "../../lib/time";
import { audit } from "../compliance/audit";
import { requestEmail } from "../messaging/send-path";
import { dollars } from "../payments/money";
import { cardsReady, receivePaymentEvent } from "../payments/payment.service";
import { firstNameOf } from "../reviews/reviews.service";
import {
  type Membership,
  applyInvoiceState,
  applySubscriptionState,
  voidOpenBills,
} from "./billing";
import { manageUrl } from "./links";
import { activePlan, ensurePrice, paymentAccountOf } from "./plans.service";

const DAY_MS = 86_400_000;

type Row = Awaited<ReturnType<typeof rowsOf>>[number];

async function rowsOf(tenantId: string, id?: string) {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ membership: planMemberships, customer: customers, planName: membershipPlans.name })
      .from(planMemberships)
      .innerJoin(customers, eq(customers.id, planMemberships.customerId))
      .innerJoin(membershipPlans, eq(membershipPlans.id, planMemberships.planId))
      .where(id ? eq(planMemberships.id, id) : ne(planMemberships.status, "pending"))
      .orderBy(desc(planMemberships.startedAt));
    const ids = rows.map((row) => row.membership.id);
    const totals = ids.length
      ? await tx
          .select({
            membershipId: membershipInvoices.membershipId,
            cents: sql<number>`coalesce(sum(${membershipInvoices.amountCents}) filter (where ${membershipInvoices.status} = 'paid'), 0)::int`,
            // Every paid bill, plan changes included: the same rows the owner sees under Bills.
            bills: sql<number>`count(*) filter (where ${membershipInvoices.status} = 'paid')::int`,
          })
          .from(membershipInvoices)
          .where(inArray(membershipInvoices.membershipId, ids))
          .groupBy(membershipInvoices.membershipId)
      : [];
    const open = ids.length
      ? await tx
          .select()
          .from(membershipInvoices)
          .where(
            and(
              inArray(membershipInvoices.membershipId, ids),
              inArray(membershipInvoices.status, ["retrying", "failed"]),
            ),
          )
          .orderBy(desc(membershipInvoices.createdAt))
      : [];
    const byMembership = new Map(totals.map((row) => [row.membershipId, row]));
    return rows.map((row) => ({
      ...row,
      totals: byMembership.get(row.membership.id) ?? { cents: 0, bills: 0 },
      // The latest unpaid bill, unless the membership was cancelled (its bills were voided).
      issue:
        row.membership.status === "canceled"
          ? undefined
          : open.find((invoice) => invoice.membershipId === row.membership.id),
    }));
  });
}

function toItem(row: Row): MembershipItem {
  const { membership, customer, totals, issue } = row;
  return {
    id: membership.id,
    status: membership.status,
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phoneE164,
      email: membership.email,
    },
    plan: { id: membership.planId, name: row.planName },
    priceCents: membership.priceCents,
    interval: membership.interval,
    monthlyCents: monthlyCents(membership.priceCents, membership.interval),
    startedAt: iso(membership.startedAt),
    nextBillAt: iso(membership.currentPeriodEnd),
    endsAt: iso(membership.endsAt),
    canceledAt: iso(membership.canceledAt),
    pausedAt: iso(membership.pausedAt),
    card:
      membership.cardBrand && membership.cardLast4
        ? { brand: membership.cardBrand, last4: membership.cardLast4 }
        : null,
    lifetimeCents: totals.cents,
    billsPaid: totals.bills,
    issue: issue
      ? {
          kind: issue.status === "failed" ? "failed" : "retrying",
          message: issue.failure,
          attempts: issue.attempts,
          nextAttemptAt: iso(issue.nextAttemptAt),
        }
      : null,
  };
}

/**
 * C-50: every member with their status, and recurring income the owner can count on: active
 * members only (past due and paused don't count), with the last 30 days' joins and cancellations.
 */
export async function listMemberships(tenantId: string): Promise<MembershipsResponse> {
  const items = (await rowsOf(tenantId)).map(toItem);
  const since = Date.now() - 30 * DAY_MS;
  const joined = items.filter((item) => item.startedAt && Date.parse(item.startedAt) >= since);
  const canceled = items.filter((item) => item.canceledAt && Date.parse(item.canceledAt) >= since);
  const monthly = (list: MembershipItem[]) =>
    list.reduce((total, item) => total + item.monthlyCents, 0);
  const ready = await withTenant(tenantId, async (tx) => cardsReady(await paymentAccountOf(tx)));
  return {
    memberships: items,
    summary: {
      mrrCents: monthly(items.filter((item) => item.status === "active")),
      mrrChangeCents: monthly(joined) - monthly(canceled),
      active: items.filter((item) => item.status === "active").length,
      pastDue: items.filter((item) => item.status === "past_due").length,
      paused: items.filter((item) => item.status === "paused").length,
      joined30d: joined.length,
      canceled30d: canceled.length,
    },
    cardsReady: ready,
  };
}

export async function getMembership(tenantId: string, id: string): Promise<MembershipDetail> {
  const [row] = await rowsOf(tenantId, id);
  if (!row) throw notFound("Membership");
  const invoices = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(membershipInvoices)
      .where(eq(membershipInvoices.membershipId, id))
      .orderBy(desc(membershipInvoices.createdAt), asc(membershipInvoices.id)),
  );
  const { membership } = row;
  return {
    ...toItem(row),
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      kind: invoice.kind,
      amountCents: invoice.amountCents,
      status: invoice.status,
      periodStart: iso(invoice.periodStart),
      periodEnd: iso(invoice.periodEnd),
      paidAt: iso(invoice.paidAt),
      attempts: invoice.attempts,
      failure: invoice.failure,
      leadId: invoice.leadId,
      createdAt: invoice.createdAt.toISOString(),
    })),
    consent: {
      text: membership.consentText,
      version: membership.consentVersion,
      at: membership.consentAt.toISOString(),
    },
  };
}

async function providerContext(tenantId: string, id: string) {
  return withTenant(tenantId, async (tx) => {
    const [membership] = await tx.select().from(planMemberships).where(eq(planMemberships.id, id));
    if (!membership) throw notFound("Membership");
    const account = await paymentAccountOf(tx);
    if (!cardsReady(account) || !membership.providerSubscriptionId)
      throw new HttpError(
        409,
        "not_billing",
        "This membership isn't billing through card payments.",
      );
    return {
      membership,
      accountId: account.providerAccountId,
      subscriptionId: membership.providerSubscriptionId,
    };
  });
}

/** The provider refused: say why, in the owner's words. */
const refused = (error: unknown): never => {
  if (error instanceof PaymentRefused) throw new HttpError(409, "payment_refused", error.message);
  throw error;
};

/**
 * C-50: the owner pauses, resumes, cancels, moves a member to another plan, or retries a declined
 * bill. Each goes to the provider first, then our records follow its answer; who did it and when
 * is in the audit trail (AC 3).
 */
export async function membershipAction(
  tenantId: string,
  id: string,
  input: z.output<typeof membershipActionInput>,
  owner: { userId: string },
): Promise<MembershipDetail> {
  const { membership, accountId, subscriptionId } = await providerContext(tenantId, id);
  const actor = `user:${owner.userId}`;
  const log = (data: Record<string, unknown> = {}) =>
    withTenant(tenantId, (tx) =>
      audit(tx, {
        tenantId,
        actor,
        action: `membership.${input.action}`,
        entityType: "membership",
        entityId: id,
        data,
      }),
    );
  try {
    switch (input.action) {
      case "pause":
        await applySubscriptionState(
          tenantId,
          await payments.pauseSubscription(accountId, subscriptionId),
        );
        break;
      case "resume":
        await applySubscriptionState(
          tenantId,
          await payments.resumeSubscription(accountId, subscriptionId),
        );
        break;
      case "cancel": {
        await withTenant(tenantId, (tx) =>
          tx.update(planMemberships).set({ canceledBy: "owner" }).where(eq(planMemberships.id, id)),
        );
        const state = await payments.cancelSubscription(accountId, subscriptionId);
        await withTenant(tenantId, (tx) => voidOpenBills(tx, id));
        await applySubscriptionState(tenantId, state);
        break;
      }
      case "retry": {
        if (membership.status === "canceled")
          throw new HttpError(
            409,
            "canceled",
            "This membership is cancelled, so its bills were voided.",
          );
        // A bill still being retried, or one whose retries ran out (it stays open until paid).
        const [bill] = await withTenant(tenantId, (tx) =>
          tx
            .select()
            .from(membershipInvoices)
            .where(
              and(
                eq(membershipInvoices.membershipId, id),
                inArray(membershipInvoices.status, ["retrying", "failed"]),
              ),
            )
            .orderBy(desc(membershipInvoices.createdAt))
            .limit(1),
        );
        if (!bill)
          throw new HttpError(409, "nothing_to_retry", "There's no declined bill to retry.");
        await applyInvoiceState(
          tenantId,
          await payments.retryInvoice(accountId, bill.providerInvoiceId),
        );
        await applySubscriptionState(
          tenantId,
          await payments.getSubscription(accountId, subscriptionId),
        );
        break;
      }
      case "change_plan":
        await changePlan(tenantId, membership, input.planId, accountId, subscriptionId);
        break;
    }
  } catch (error) {
    refused(error);
  }
  await log(input.action === "change_plan" ? { from: membership.planId, to: input.planId } : {});
  return getMembership(tenantId, id);
}

/** Moves a member to another plan on the same schedule; the provider prorates the difference (C-49). */
async function changePlan(
  tenantId: string,
  membership: Membership,
  planId: string,
  accountId: string,
  subscriptionId: string,
) {
  if (planId === membership.planId)
    throw new HttpError(409, "same_plan", "They're already on that plan.");
  const plan = await tenantWork(tenantId, async (tx) => {
    const target = await activePlan(tx, planId);
    if (!target)
      throw new HttpError(422, "validation_failed", "Pick an active plan.", {
        planId: ["Pick an active plan"],
      });
    if (target.interval !== membership.interval)
      throw new HttpError(
        422,
        "validation_failed",
        "That plan bills on a different schedule. Cancel this one and have them join it instead.",
      );
    const priceId = await ensurePrice(tx, target);
    return { ...target, providerPriceId: priceId };
  });
  if (!plan.providerPriceId)
    throw new HttpError(409, "not_billing", "Card payments aren't set up.");
  const { subscription, invoice } = await payments.changeSubscriptionPrice(
    accountId,
    subscriptionId,
    plan.providerPriceId,
  );
  await tenantWork(tenantId, async (tx, fx) => {
    await tx
      .update(planMemberships)
      .set({ planId: plan.id })
      .where(eq(planMemberships.id, membership.id));
    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, membership.customerId));
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    await requestEmail(tx, fx, {
      tenant: tenant!,
      customerId: membership.customerId,
      leadId: null,
      to: membership.email,
      purpose: "transactional",
      subject: `Your plan is now ${plan.name}`,
      body: [
        `Hi ${firstNameOf(customer?.name) ?? "there"},`,
        `Your membership has moved to ${plan.name}, at ${planPrice(subscription.amountCents, subscription.interval)}.${
          invoice
            ? ` The difference for the rest of this ${subscription.interval}, ${dollars(invoice.amountCents)}, is billed now.`
            : " Any difference for the rest of this period comes off your next bill."
        }`,
        `Manage your plan: ${manageUrl(membership.id)}`,
      ].join("\n\n"),
    });
  });
  await applySubscriptionState(tenantId, subscription);
  if (invoice) await applyInvoiceState(tenantId, invoice);
}

/* ── Development: Stripe's clock, simulated ─────────────────────────────── */

async function simulatedSubscription(tenantId: string, id: string) {
  if (payments.name !== "simulator")
    throw new HttpError(
      409,
      "not_simulated",
      "Billing goes through Stripe, so the simulator is off.",
    );
  const { subscriptionId } = await providerContext(tenantId, id);
  return subscriptionId;
}

/** Bills the next period now, with a card that pays or declines; handled like Stripe's webhooks. */
export async function simulateRenewal(tenantId: string, id: string, outcome: "pay" | "decline") {
  const subscriptionId = await simulatedSubscription(tenantId, id);
  try {
    for (const event of simulatorPayments.renewNow(subscriptionId, outcome))
      await receivePaymentEvent(event);
  } catch (error) {
    refused(error);
  }
  return getMembership(tenantId, id);
}

/** Runs a declined bill's next retry now, as if the days had passed. */
export async function simulateRetry(tenantId: string, id: string) {
  const subscriptionId = await simulatedSubscription(tenantId, id);
  try {
    for (const event of simulatorPayments.retryDueNow(subscriptionId))
      await receivePaymentEvent(event);
  } catch (error) {
    refused(error);
  }
  return getMembership(tenantId, id);
}

/** Every 15 minutes: the simulator's billing clock (Stripe runs its own and sends webhooks). */
export async function membershipsTickJob() {
  if (payments.name !== "simulator") return;
  for (const event of simulatorPayments.advanceBilling()) await receivePaymentEvent(event);
}
