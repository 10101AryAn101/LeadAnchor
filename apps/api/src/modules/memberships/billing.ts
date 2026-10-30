import { type MembershipStatus, formatPhone, planPrice, workDue } from "@leadanchor/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import { payments } from "../../container";
import type { Tx } from "../../db/client";
import {
  customers,
  leads,
  membershipInvoices,
  membershipPlans,
  planMemberships,
  services,
  tenants,
} from "../../db/schema";
import { type Effects, tenantWork } from "../../db/unit-of-work";
import type { InvoiceState, SubscriptionState } from "../../integrations/payments/types";
import { zonedParts } from "../../lib/zoned";
import { audit } from "../compliance/audit";
import { addLeadEvent, topPosition } from "../leads/lead-capture";
import { requestEmail } from "../messaging/send-path";
import { notifyOwner } from "../notifications/notify";
import { cardLabel, dollars } from "../payments/money";
import { firstNameOf } from "../reviews/reviews.service";
import { manageUrl } from "./links";

type Tenant = typeof tenants.$inferSelect;
type Plan = typeof membershipPlans.$inferSelect;
export type Membership = typeof planMemberships.$inferSelect;
type Customer = typeof customers.$inferSelect;
type Invoice = typeof membershipInvoices.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The provider's subscription, as the owner sees it: a cancellation that runs to the period's end already counts as cancelled. */
export const statusOf = (state: SubscriptionState): MembershipStatus =>
  state.status === "active" && state.endsAt ? "canceled" : state.status;

/** "Nov 30, 2026" in the business's time zone. */
export const dayOf = (date: Date, timeZone: string) =>
  date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });

interface Party {
  tenant: Tenant;
  membership: Membership;
  plan: Plan;
  customer: Customer;
}

async function partyOf(tx: Tx, membership: Membership): Promise<Party> {
  const [[tenant], [plan], [customer]] = await Promise.all([
    tx.select().from(tenants).where(eq(tenants.id, membership.tenantId)),
    tx.select().from(membershipPlans).where(eq(membershipPlans.id, membership.planId)),
    tx.select().from(customers).where(eq(customers.id, membership.customerId)),
  ]);
  return { tenant: tenant!, membership, plan: plan!, customer: customer! };
}

/** Finds our membership for a provider subscription: by its id, or by our own id it carries. */
async function membershipFor(tx: Tx, subscriptionId: string, reference: string) {
  const [bySubscription] = await tx
    .select()
    .from(planMemberships)
    .where(
      and(
        eq(planMemberships.provider, payments.name),
        eq(planMemberships.providerSubscriptionId, subscriptionId),
      ),
    )
    .limit(1);
  if (bySubscription) return bySubscription;
  if (!UUID.test(reference)) return null;
  const [byReference] = await tx
    .select()
    .from(planMemberships)
    .where(eq(planMemberships.id, reference))
    .limit(1);
  return byReference ?? null;
}

/** An email to the member: receipts, notices, confirmations. Account email, so no opt-in needed. */
async function tellMember(tx: Tx, fx: Effects, party: Party, subject: string, lines: string[]) {
  const first = firstNameOf(party.customer.name);
  await requestEmail(tx, fx, {
    tenant: party.tenant,
    customerId: party.customer.id,
    leadId: null,
    to: party.membership.email,
    purpose: "transactional",
    subject,
    body: [`Hi ${first ?? "there"},`, ...lines, party.tenant.name].join("\n\n"),
  });
}

const manageLine = (membershipId: string) =>
  `Manage your plan, update your card or cancel: ${manageUrl(membershipId)}`;
const memberName = (party: Party) =>
  party.customer.name ??
  (party.customer.phoneE164 ? formatPhone(party.customer.phoneE164) : party.membership.email);

/** What a member has paid: every paid bill, and how many of those were plan bills (cycles). */
async function paidHistory(tx: Tx, membershipId: string) {
  const [row] = await tx
    .select({
      bills: sql<number>`count(*) filter (where ${membershipInvoices.status} = 'paid')::int`,
      cycles: sql<number>`count(*) filter (where ${membershipInvoices.status} = 'paid' and ${membershipInvoices.kind} = 'cycle')::int`,
      cents: sql<number>`coalesce(sum(${membershipInvoices.amountCents}) filter (where ${membershipInvoices.status} = 'paid'), 0)::int`,
    })
    .from(membershipInvoices)
    .where(eq(membershipInvoices.membershipId, membershipId));
  return { bills: row?.bills ?? 0, cycles: row?.cycles ?? 0, cents: row?.cents ?? 0 };
}

/**
 * A subscription changed at the provider (webhook, or the result of an owner action): the
 * membership follows it, the change is audited, and member and owner hear about what matters.
 */
export async function applySubscriptionState(tenantId: string, state: SubscriptionState) {
  await tenantWork(tenantId, async (tx, fx) => {
    const membership = await membershipFor(tx, state.subscriptionId, state.reference);
    if (!membership) return;
    const before = membership.status;
    const status = statusOf(state);
    const now = new Date();
    const [updated] = await tx
      .update(planMemberships)
      .set({
        status,
        provider: payments.name,
        providerSubscriptionId: state.subscriptionId,
        providerCustomerId: state.customerId,
        providerPriceId: state.priceId,
        priceCents: state.amountCents,
        interval: state.interval,
        cardBrand: state.cardBrand,
        cardLast4: state.cardLast4,
        currentPeriodEnd:
          status === "active" || status === "past_due" ? state.currentPeriodEnd : null,
        endsAt: state.endsAt,
        ...(before === "pending" &&
          status !== "pending" && { startedAt: membership.startedAt ?? now }),
        pausedAt: status === "paused" ? (membership.pausedAt ?? now) : null,
        ...(status === "canceled" &&
          !membership.canceledAt && {
            canceledAt: now,
            canceledBy: membership.canceledBy ?? "customer",
          }),
      })
      .where(eq(planMemberships.id, membership.id))
      .returning();
    fx.publish({ type: "membership.updated", membershipId: membership.id });
    if (before === status) return;

    await audit(tx, {
      tenantId,
      actor: `${payments.name}:webhook`,
      action: "membership.status_changed",
      entityType: "membership",
      entityId: membership.id,
      data: { from: before, to: status, subscription: state.subscriptionId },
    });
    const party = await partyOf(tx, updated!);
    const timeZone = party.tenant.timezone;
    const nextBill = updated!.currentPeriodEnd ? dayOf(updated!.currentPeriodEnd, timeZone) : null;

    if (before === "pending") {
      const includes = party.plan.includes.length
        ? `Your plan includes:\n${party.plan.includes.map((item) => `• ${item}`).join("\n")}`
        : null;
      await tellMember(tx, fx, party, `Welcome to ${party.plan.name}`, [
        party.plan.welcomeMessage ||
          `Thank you for joining ${party.plan.name}. We're glad to have you.`,
        ...(includes ? [includes] : []),
        `${planPrice(updated!.priceCents, updated!.interval)}${nextBill ? `. Next bill: ${nextBill}` : ""}.`,
        manageLine(membership.id),
      ]);
      await notifyOwner(tx, fx, {
        tenantId,
        kind: "membership",
        title: `New member: ${memberName(party)}`,
        body: `Joined ${party.plan.name} at ${planPrice(updated!.priceCents, updated!.interval)}.`,
        callbackPhone: party.customer.phoneE164,
        path: `/memberships?m=${membership.id}`,
      });
      return;
    }
    if (status === "canceled") {
      const ends =
        updated!.endsAt && updated!.endsAt > now ? dayOf(updated!.endsAt, timeZone) : null;
      // C-52 AC 2: confirmed in writing.
      await tellMember(tx, fx, party, `Your ${party.plan.name} is cancelled`, [
        `This confirms your ${party.plan.name} membership is cancelled, and you won't be charged again.${ends ? ` Your plan stays active until ${ends}.` : ""}`,
        "Changed your mind? Just reply and we'll set you up again.",
      ]);
      // C-52 AC 3: the owner hears about every cancellation, with the member's history.
      const history = await paidHistory(tx, membership.id);
      const since = updated!.startedAt
        ? updated!.startedAt.toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
            timeZone,
          })
        : null;
      await notifyOwner(tx, fx, {
        tenantId,
        kind: "membership",
        title:
          updated!.canceledBy === "owner"
            ? `${memberName(party)}'s ${party.plan.name} is cancelled`
            : `${memberName(party)} cancelled ${party.plan.name}`,
        body: [
          updated!.canceledBy === "owner" ? "You cancelled it." : "They cancelled online.",
          since
            ? `Member since ${since}, ${history.bills} ${history.bills === 1 ? "bill" : "bills"} paid (${dollars(history.cents)}).`
            : null,
          ends ? `Their plan runs until ${ends}.` : null,
        ]
          .filter(Boolean)
          .join(" "),
        callbackPhone: party.customer.phoneE164,
        path: `/memberships?m=${membership.id}`,
      });
      return;
    }
    if (status === "paused")
      await tellMember(tx, fx, party, `Your ${party.plan.name} is paused`, [
        `Your ${party.plan.name} membership is paused, and you won't be charged while it is.`,
        manageLine(membership.id),
      ]);
    if (before === "paused" && status === "active")
      await tellMember(tx, fx, party, `Your ${party.plan.name} is active again`, [
        `Welcome back! Your ${party.plan.name} membership is active again.${nextBill ? ` Next bill: ${nextBill}.` : ""}`,
        manageLine(membership.id),
      ]);
  });
}

/**
 * A bill changed at the provider: paid (receipt, and the plan's job on the board), declined
 * (a notice to the member, who can swap the card), or failed after every retry (the owner is
 * alerted: a membership never lapses silently, C-49 AC 2).
 */
export async function applyInvoiceState(tenantId: string, state: InvoiceState) {
  await tenantWork(tenantId, async (tx, fx) => {
    const membership = await membershipFor(tx, state.subscriptionId, state.reference);
    if (!membership) return;
    const [previous] = await tx
      .select()
      .from(membershipInvoices)
      .where(eq(membershipInvoices.providerInvoiceId, state.invoiceId))
      .limit(1);
    const values = {
      kind: state.kind,
      amountCents: state.amountCents,
      status: state.status,
      periodStart: state.periodStart,
      periodEnd: state.periodEnd,
      paidAt: state.paidAt,
      attempts: state.attempts,
      nextAttemptAt: state.nextAttemptAt,
      failure: state.failure,
    };
    const [invoice] = previous
      ? await tx
          .update(membershipInvoices)
          .set(values)
          .where(eq(membershipInvoices.id, previous.id))
          .returning()
      : await tx
          .insert(membershipInvoices)
          .values({
            tenantId,
            membershipId: membership.id,
            providerInvoiceId: state.invoiceId,
            ...values,
          })
          .returning();
    fx.publish({ type: "membership.updated", membershipId: membership.id });
    if (previous && previous.status === state.status && previous.attempts === state.attempts)
      return;

    const party = await partyOf(tx, membership);
    const timeZone = party.tenant.timezone;
    if (state.status === "paid" && previous?.status !== "paid") {
      await audit(tx, {
        tenantId,
        actor: `${payments.name}:webhook`,
        action: "membership.paid",
        entityType: "membership",
        entityId: membership.id,
        data: { invoice: state.invoiceId, amountCents: state.amountCents, kind: state.kind },
      });
      await sendReceipt(tx, fx, party, invoice!);
      if (state.kind === "cycle") await makeWork(tx, fx, party, invoice!);
      // Known before, unpaid: a declined bill that has now gone through.
      if (previous)
        await notifyOwner(tx, fx, {
          tenantId,
          kind: "membership",
          title: `${memberName(party)}'s payment went through`,
          body: `${dollars(state.amountCents)} for ${party.plan.name}, after an earlier decline.`,
          path: `/memberships?m=${membership.id}`,
        });
      return;
    }
    // A bill voided by a cancellation needs no chasing.
    if (membership.status === "canceled") return;
    if (state.status === "retrying" && state.attempts > invoice!.noticedAttempts) {
      await audit(tx, {
        tenantId,
        actor: `${payments.name}:webhook`,
        action: "membership.payment_declined",
        entityType: "membership",
        entityId: membership.id,
        data: {
          invoice: state.invoiceId,
          attempt: state.attempts,
          nextAttemptAt: state.nextAttemptAt?.toISOString() ?? null,
        },
      });
      await tellMember(tx, fx, party, `Your ${party.plan.name} payment didn't go through`, [
        `Your card was declined for your ${party.plan.name} payment of ${dollars(state.amountCents)}.${
          state.nextAttemptAt ? ` We'll try again on ${dayOf(state.nextAttemptAt, timeZone)}.` : ""
        }`,
        `To use another card, or to cancel, open: ${manageUrl(membership.id)}`,
      ]);
      await tx
        .update(membershipInvoices)
        .set({ noticedAttempts: state.attempts })
        .where(eq(membershipInvoices.id, invoice!.id));
      return;
    }
    if (state.status === "failed" && !invoice!.ownerAlertedAt) {
      await audit(tx, {
        tenantId,
        actor: `${payments.name}:webhook`,
        action: "membership.past_due",
        entityType: "membership",
        entityId: membership.id,
        data: { invoice: state.invoiceId, attempts: state.attempts },
      });
      await tellMember(tx, fx, party, `Your ${party.plan.name} payment is overdue`, [
        `We couldn't take ${dollars(state.amountCents)} for your ${party.plan.name} after ${state.attempts} tries, so your plan is on hold until the card is updated.`,
        `Update your card here: ${manageUrl(membership.id)}`,
      ]);
      await notifyOwner(tx, fx, {
        tenantId,
        kind: "membership",
        title: `${memberName(party)}'s ${party.plan.name} is past due`,
        body: `Their card was declined ${state.attempts} times and Stripe has stopped retrying. It stays past due until they update the card or you cancel it.`,
        callbackPhone: party.customer.phoneE164,
        path: `/memberships?m=${membership.id}`,
      });
      await tx
        .update(membershipInvoices)
        .set({ ownerAlertedAt: new Date() })
        .where(eq(membershipInvoices.id, invoice!.id));
    }
  });
}

/** C-49 AC 3: a receipt for every successful charge, with the link to manage or cancel (C-52). */
async function sendReceipt(tx: Tx, fx: Effects, party: Party, invoice: Invoice) {
  if (invoice.receiptSentAt) return;
  const timeZone = party.tenant.timezone;
  const card = cardLabel(party.membership.cardBrand, party.membership.cardLast4);
  const [current] = await tx
    .select()
    .from(planMemberships)
    .where(eq(planMemberships.id, party.membership.id));
  const next =
    current?.currentPeriodEnd && current.status === "active"
      ? dayOf(current.currentPeriodEnd, timeZone)
      : null;
  await tellMember(tx, fx, party, `Receipt: ${party.plan.name} (${dollars(invoice.amountCents)})`, [
    `Thank you! We charged ${dollars(invoice.amountCents)}${card ? ` to your ${card}` : ""} for ${
      invoice.kind === "proration" ? `the change to ${party.plan.name}` : party.plan.name
    } on ${dayOf(invoice.paidAt ?? new Date(), timeZone)}.${next ? ` Next bill: ${next}.` : ""}`,
    manageLine(party.membership.id),
  ]);
  await tx
    .update(membershipInvoices)
    .set({ receiptSentAt: new Date() })
    .where(eq(membershipInvoices.id, invoice.id));
}

/**
 * C-51: a paid plan bill puts the plan's job in the New column, on the plan's cadence. Decided
 * once per bill (a re-delivered webhook finds it decided), and only for confirmed payments.
 */
async function makeWork(tx: Tx, fx: Effects, party: Party, invoice: Invoice) {
  if (invoice.workDoneAt) return;
  const { cycles } = await paidHistory(tx, party.membership.id);
  const month = zonedParts(invoice.paidAt ?? new Date(), party.tenant.timezone).month;
  let leadId: string | null = null;
  if (workDue(party.plan.workCadence, cycles, month)) {
    const [service] = party.plan.workServiceId
      ? await tx.select().from(services).where(eq(services.id, party.plan.workServiceId))
      : [];
    const period = invoice.periodStart
      ? invoice.periodStart.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: party.tenant.timezone,
        })
      : null;
    const [lead] = await tx
      .insert(leads)
      .values({
        tenantId: party.tenant.id,
        customerId: party.customer.id,
        source: "membership",
        title: service?.name ?? party.plan.name,
        summary: `Paid for by their ${party.plan.name} membership${period ? ` (${period})` : ""}. Book the visit.`,
        serviceCategory: service?.name ?? null,
        needsCallback: false,
        position: await topPosition(tx, party.tenant.id, "new"),
      })
      .returning({ id: leads.id });
    leadId = lead!.id;
    await addLeadEvent(tx, {
      tenantId: party.tenant.id,
      leadId,
      type: "membership.paid",
      data: {
        membershipId: party.membership.id,
        plan: party.plan.name,
        invoiceId: invoice.id,
        amountCents: invoice.amountCents,
        period,
        bill: cycles,
      },
    });
    fx.publish({ type: "lead.created", leadId });
  }
  await tx
    .update(membershipInvoices)
    .set({ workDoneAt: new Date(), leadId })
    .where(eq(membershipInvoices.id, invoice.id));
}

/** Bills still being retried for these memberships, to void when one is cancelled. */
export async function voidOpenBills(tx: Tx, membershipId: string) {
  await tx
    .update(membershipInvoices)
    .set({ status: "failed", nextAttemptAt: null, failure: "Cancelled before it was paid." })
    .where(
      and(
        eq(membershipInvoices.membershipId, membershipId),
        inArray(membershipInvoices.status, ["retrying"]),
      ),
    );
}
