import {
  MEMBERSHIP_CONSENT_VERSION,
  type MembershipStatus,
  type PublicMembership,
  type PublicPlan,
  membershipConsentText,
  membershipTerms,
  type planJoinInput,
} from "@leadanchor/contracts";
import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { payments } from "../../container";
import { systemDb, withTenant } from "../../db/client";
import {
  customers,
  membershipPlans,
  paymentAccounts,
  planMemberships,
  tenants,
} from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { PaymentRefused } from "../../integrations/payments/types";
import { HttpError, notFound } from "../../lib/errors";
import { audit } from "../compliance/audit";
import { upsertCustomerByPhone } from "../customers/customer.repo";
import { requestEmail } from "../messaging/send-path";
import { cardsReady, publicBusinessOf } from "../payments/payment.service";
import { firstNameOf } from "../reviews/reviews.service";
import { applySubscriptionState } from "./billing";
import { manageUrl, resolveManageToken, signupUrl } from "./links";
import { ensurePrice } from "./plans.service";

type Tenant = typeof tenants.$inferSelect;
type Plan = typeof membershipPlans.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOINS_PER_HOUR = 5;
const recentJoins = new Map<string, number[]>();
const recentResends = new Map<string, number>();

async function planByToken(token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) throw notFound("Plan");
  const [row] = await systemDb
    .select({ plan: membershipPlans, tenant: tenants })
    .from(membershipPlans)
    .innerJoin(tenants, eq(tenants.id, membershipPlans.tenantId))
    .where(eq(membershipPlans.linkToken, token))
    .limit(1);
  if (!row || row.tenant.status === "cancelled" || row.tenant.status === "suspended")
    throw notFound("Plan");
  return row;
}

async function accountOf(tenantId: string) {
  const [account] = await systemDb
    .select()
    .from(paymentAccounts)
    .where(eq(paymentAccounts.tenantId, tenantId));
  return account ?? null;
}

const pricing = (tenant: Tenant, plan: Plan) => ({
  business: tenant.name,
  priceCents: plan.priceCents,
  interval: plan.interval,
});

/** The plan's sign-up page: what's included, and every term in full before they pay (C-48 AC 3). */
export async function getPublicPlan(token: string): Promise<PublicPlan> {
  const { plan, tenant } = await planByToken(token);
  return {
    business: await publicBusinessOf(tenant),
    available: plan.status === "active" && cardsReady(await accountOf(tenant.id)),
    plan: {
      name: plan.name,
      description: plan.description,
      priceCents: plan.priceCents,
      interval: plan.interval,
      includes: plan.includes,
    },
    terms: membershipTerms(pricing(tenant, plan)),
    consentText: membershipConsentText(pricing(tenant, plan)),
  };
}

/**
 * C-49 AC 1: they tick the box agreeing to the recurring charge; the exact words, version, time
 * and address are recorded (and in the audit trail) before Stripe's hosted page takes the card.
 */
export async function joinPlan(
  token: string,
  input: z.output<typeof planJoinInput>,
  meta: { ipAddress: string | null; origin: string | null },
) {
  const { plan, tenant } = await planByToken(token);
  if (input.company)
    throw new HttpError(
      400,
      "bad_request",
      "Something went wrong. Please call the business instead.",
    );
  if (plan.status !== "active")
    throw new HttpError(409, "plan_closed", `${plan.name} isn't taking new members.`);
  const account = await accountOf(tenant.id);
  if (!cardsReady(account))
    throw new HttpError(409, "cards_off", `${tenant.name} isn't taking card payments online yet.`);

  const key = `${tenant.id}:${meta.ipAddress ?? "unknown"}`;
  const recent = (recentJoins.get(key) ?? []).filter((at) => Date.now() - at < 3_600_000);
  if (recent.length >= JOINS_PER_HOUR)
    throw new HttpError(429, "too_many_requests", `Please call ${tenant.name} to join.`);
  if (recentJoins.size > 10_000) recentJoins.clear();
  recentJoins.set(key, [...recent, Date.now()]);

  const consentText = membershipConsentText(pricing(tenant, plan));
  const { membershipId, priceId } = await tenantWork(tenant.id, async (tx) => {
    const priceId = await ensurePrice(tx, plan);
    const customer = await upsertCustomerByPhone(tx, tenant.id, input.phone, {
      name: input.name,
      email: input.email,
    });
    const [existing] = await tx
      .select({ id: planMemberships.id })
      .from(planMemberships)
      .where(
        and(
          eq(planMemberships.customerId, customer.id),
          eq(planMemberships.planId, plan.id),
          inArray(planMemberships.status, ["active", "past_due", "paused"]),
        ),
      )
      .limit(1);
    if (existing)
      throw new HttpError(
        409,
        "already_member",
        `You're already a member of ${plan.name}. The link in your receipts manages it.`,
      );
    const [membership] = await tx
      .insert(planMemberships)
      .values({
        tenantId: tenant.id,
        planId: plan.id,
        customerId: customer.id,
        status: "pending",
        priceCents: plan.priceCents,
        interval: plan.interval,
        providerPriceId: priceId,
        email: input.email,
        consentText,
        consentVersion: MEMBERSHIP_CONSENT_VERSION,
        consentAt: new Date(),
        consentIp: meta.ipAddress,
      })
      .returning({ id: planMemberships.id });
    await audit(tx, {
      tenantId: tenant.id,
      actor: "customer",
      action: "membership.consent",
      entityType: "membership",
      entityId: membership!.id,
      data: {
        text: consentText,
        version: MEMBERSHIP_CONSENT_VERSION,
        ip: meta.ipAddress,
        priceCents: plan.priceCents,
        interval: plan.interval,
      },
    });
    return { membershipId: membership!.id, priceId };
  });
  if (!priceId)
    throw new HttpError(409, "cards_off", `${tenant.name} isn't taking card payments online yet.`);

  try {
    const session = await payments.createSubscriptionCheckout({
      accountId: account.providerAccountId,
      priceId,
      businessName: tenant.name,
      planName: plan.name,
      terms: membershipTerms(pricing(tenant, plan)),
      customerEmail: input.email,
      // Back to the address they came from (the shared link's, unless they opened another of ours).
      successUrl: `${meta.origin ? `${meta.origin}/m/${token}` : signupUrl(token)}?joined=${membershipId}`,
      cancelUrl: meta.origin ? `${meta.origin}/m/${token}` : signupUrl(token),
      reference: membershipId,
      idempotencyKey: `join:${membershipId}`,
    });
    await withTenant(tenant.id, (tx) =>
      tx
        .update(planMemberships)
        .set({ provider: payments.name, providerCheckoutId: session.id })
        .where(eq(planMemberships.id, membershipId)),
    );
    return { url: session.url };
  } catch (error) {
    if (error instanceof PaymentRefused) throw new HttpError(409, "payment_refused", error.message);
    throw error;
  }
}

/** Back from the hosted checkout: check with the provider now rather than wait for its webhook. */
export async function joinedStatus(
  token: string,
  membershipId: string,
): Promise<{ status: MembershipStatus }> {
  const { tenant } = await planByToken(token);
  if (!UUID.test(membershipId)) throw notFound("Membership");
  const read = () =>
    withTenant(tenant.id, (tx) =>
      tx.select().from(planMemberships).where(eq(planMemberships.id, membershipId)).limit(1),
    );
  const [membership] = await read();
  if (!membership) throw notFound("Membership");
  if (membership.status === "pending" && membership.providerCheckoutId) {
    const account = await accountOf(tenant.id);
    const state = cardsReady(account)
      ? await payments
          .subscriptionForCheckout(account.providerAccountId, membership.providerCheckoutId)
          .catch(() => null)
      : null;
    if (state) await applySubscriptionState(tenant.id, state);
  }
  const [fresh] = await read();
  return { status: fresh!.status };
}

async function membershipByLink(token: string) {
  const resolved = resolveManageToken(token);
  if (!resolved || !UUID.test(resolved.membershipId)) throw notFound("Link");
  const [row] = await systemDb
    .select({
      membership: planMemberships,
      tenant: tenants,
      planName: membershipPlans.name,
      customerName: customers.name,
    })
    .from(planMemberships)
    .innerJoin(tenants, eq(tenants.id, planMemberships.tenantId))
    .innerJoin(membershipPlans, eq(membershipPlans.id, planMemberships.planId))
    .innerJoin(customers, eq(customers.id, planMemberships.customerId))
    .where(eq(planMemberships.id, resolved.membershipId))
    .limit(1);
  if (!row) throw notFound("Link");
  return { ...row, expired: resolved.expired };
}

/** C-52: the member's own page from every receipt. One membership, and only while the link is fresh. */
export async function getPublicMembership(token: string): Promise<PublicMembership> {
  const { membership, tenant, planName, customerName, expired } = await membershipByLink(token);
  return {
    business: await publicBusinessOf(tenant),
    expired,
    member: expired
      ? null
      : {
          firstName: firstNameOf(customerName),
          plan: planName,
          priceCents: membership.priceCents,
          interval: membership.interval,
          status: membership.status,
          nextBillAt: membership.currentPeriodEnd?.toISOString() ?? null,
          endsAt: membership.endsAt?.toISOString() ?? null,
        },
  };
}

/** Into Stripe's customer portal: change the card, see bills, or cancel in two taps (C-52 AC 1). */
export async function openPortal(token: string, returnUrl: string): Promise<{ url: string }> {
  const { membership, tenant, expired } = await membershipByLink(token);
  if (expired)
    throw new HttpError(
      410,
      "link_expired",
      "This link has expired. We can email you a fresh one.",
    );
  const account = await accountOf(tenant.id);
  if (!cardsReady(account) || !membership.providerCustomerId)
    throw new HttpError(409, "not_billing", `Please call ${tenant.name} about your plan.`);
  try {
    return {
      url: await payments.portalUrl(
        account.providerAccountId,
        membership.providerCustomerId,
        returnUrl,
      ),
    };
  } catch (error) {
    if (error instanceof PaymentRefused) throw new HttpError(409, "payment_refused", error.message);
    throw error;
  }
}

/** An expired link can still ask for a fresh one, sent to the email the member signed up with. */
export async function resendManageLink(token: string): Promise<{ sent: true }> {
  const { membership, tenant, planName, customerName } = await membershipByLink(token);
  const last = recentResends.get(membership.id) ?? 0;
  if (Date.now() - last < 10 * 60_000) return { sent: true };
  recentResends.set(membership.id, Date.now());
  await tenantWork(tenant.id, async (tx, fx) => {
    await requestEmail(tx, fx, {
      tenant,
      customerId: membership.customerId,
      leadId: null,
      to: membership.email,
      purpose: "transactional",
      subject: `Your link to manage ${planName}`,
      body: [
        `Hi ${firstNameOf(customerName) ?? "there"},`,
        membership.status === "canceled"
          ? `Here's a fresh link to see your ${planName} and your bills.`
          : `Here's a fresh link to manage your ${planName}: update your card, see your bills, or cancel.`,
        manageUrl(membership.id),
        tenant.name,
      ].join("\n\n"),
    });
  });
  return { sent: true };
}
