import { type BillingResponse, type Tier, type TierChoiceResult, accessTier } from "@leadanchor/contracts";
import { eq } from "drizzle-orm";
import { billing } from "../../container";
import { systemDb } from "../../db/client";
import { tenants, webhookInbox } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import type { AddonSubscription, TierSubscription } from "../../integrations/billing/types";
import { QUEUES } from "../../jobs/queue";
import { PaymentRefused } from "../../integrations/payments/types";
import { HttpError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { audit } from "../compliance/audit";
import { applyReferralCredits, recordReferral } from "../network/referrals";
import { siteUrl } from "../profile/links";

type Tenant = typeof tenants.$inferSelect;

async function tenantOf(tenantId: string) {
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw new HttpError(404, "not_found", "Business not found.");
  return tenant;
}

const refused = (error: unknown): never => {
  if (error instanceof PaymentRefused) throw new HttpError(409, "payment_refused", error.message);
  throw error;
};

function billingOf(tenant: Tenant, creditCents: number): BillingResponse {
  return {
    status: tenant.status,
    tier: accessTier(tenant),
    paidTier: tenant.tier,
    trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
    periodEnd: tenant.billingPeriodEnd?.toISOString() ?? null,
    cancelsAt: tenant.billingCancelsAt?.toISOString() ?? null,
    creditCents,
    manageable: Boolean(tenant.billingCustomerId),
    simulated: billing.name === "simulator",
    website: {
      status: tenant.websiteStatus,
      cancelsAt: tenant.websiteCancelsAt?.toISOString() ?? null,
      url: siteUrl(tenant.slug),
    },
  };
}

/** The business's LeadAnchor plan as Settings shows it, with any referral credit waiting. */
export async function getBilling(tenantId: string): Promise<BillingResponse> {
  const tenant = await tenantOf(tenantId);
  // The credit balance is a nicety: an unreachable provider shouldn't hide the plan.
  const credit = tenant.billingCustomerId ? await billing.creditCents(tenant.billingCustomerId).catch(() => 0) : 0;
  return billingOf(tenant, credit);
}

/**
 * The owner picked a tier. Already subscribed: switch now (the provider settles the difference).
 * Otherwise: the provider's checkout, with no charge until any trial days left have run out.
 */
export async function chooseTier(
  tenantId: string,
  userId: string,
  tier: Tier,
  ctx: { email: string; origin: string },
): Promise<TierChoiceResult> {
  const tenant = await tenantOf(tenantId);
  const subscribed = tenant.billingSubscriptionId && (tenant.status === "active" || tenant.status === "past_due");
  try {
    if (subscribed) {
      if (tenant.tier !== tier || tenant.billingCancelsAt) {
        await applyTierSubscription(await billing.changeTier(tenant.billingSubscriptionId!, tier, tenant.name), `user:${userId}`);
      }
      return { billing: await getBilling(tenantId) };
    }
    const { url } = await billing.checkout({
      tenantId,
      tier,
      customerId: tenant.billingCustomerId,
      email: ctx.email,
      businessName: tenant.name,
      successUrl: `${ctx.origin}/settings?billing=back&checkout={CHECKOUT_SESSION_ID}#plan`,
      cancelUrl: `${ctx.origin}/settings#plan`,
      trialEndsAt: tenant.status === "trial" ? tenant.trialEndsAt : null,
    });
    return { url };
  } catch (error) {
    return refused(error);
  }
}

/** Back from the provider's checkout or billing page: catch up without waiting for its webhook. */
export async function refreshBilling(tenantId: string, checkoutId?: string): Promise<BillingResponse> {
  const tenant = await tenantOf(tenantId);
  try {
    // A checkout is for a tier or for the website add-on (C-33): whichever it turns out to be.
    const addon = checkoutId
      ? await billing.addonForCheckout(checkoutId)
      : tenant.websiteSubscriptionId
        ? await billing.getAddon(tenant.websiteSubscriptionId)
        : null;
    const state = checkoutId
      ? addon
        ? null
        : await billing.subscriptionForCheckout(checkoutId)
      : tenant.billingSubscriptionId
        ? await billing.getSubscription(tenant.billingSubscriptionId)
        : null;
    // A checkout id comes from the address bar, so it only counts for the business it was made for.
    if (state && state.tenantId === tenantId) await applyTierSubscription(state, "billing");
    if (addon && addon.tenantId === tenantId) await applyAddonSubscription(addon, "billing");
  } catch (error) {
    refused(error);
  }
  return getBilling(tenantId);
}

/** C-33: the provider's checkout for the website add-on: the setup fee today, then hosting each month. */
export async function chooseWebsite(tenantId: string, ctx: { email: string; origin: string }) {
  const tenant = await tenantOf(tenantId);
  if (tenant.websiteStatus === "active" || tenant.websiteStatus === "past_due") {
    throw new HttpError(409, "already_live", "Your website is already live.");
  }
  try {
    return await billing.addonCheckout({
      tenantId,
      customerId: tenant.billingCustomerId,
      email: ctx.email,
      businessName: tenant.name,
      successUrl: `${ctx.origin}/settings?billing=back&checkout={CHECKOUT_SESSION_ID}#website`,
      cancelUrl: `${ctx.origin}/settings#website`,
    });
  } catch (error) {
    return refused(error);
  }
}

/** Stops the website's hosting at the end of the paid month, or keeps it after all. */
export async function setWebsiteCancel(tenantId: string, userId: string, cancel: boolean): Promise<BillingResponse> {
  const tenant = await tenantOf(tenantId);
  if (!tenant.websiteSubscriptionId) throw new HttpError(409, "no_website", "Add the website first.");
  try {
    await applyAddonSubscription(await billing.setAddonCancel(tenant.websiteSubscriptionId, cancel), `user:${userId}`);
  } catch (error) {
    refused(error);
  }
  return getBilling(tenantId);
}

/**
 * The website add-on's news (checkout return, Settings, webhook, simulator). Going live points the
 * Google listing's website link at the new site (C-33 AC "GBP link set").
 */
export async function applyAddonSubscription(state: AddonSubscription, actor: string): Promise<boolean> {
  if (!state.tenantId || state.status === "incomplete") return false;
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.id, state.tenantId));
  if (!tenant) return false;
  if (tenant.websiteSubscriptionId && tenant.websiteSubscriptionId !== state.subscriptionId && state.status === "canceled") return false;
  const status = state.status === "active" ? "active" : state.status === "past_due" ? "past_due" : "cancelled";
  const wasLive = tenant.websiteStatus === "active" || tenant.websiteStatus === "past_due";
  const live = status === "active" || status === "past_due";
  await tenantWork(tenant.id, async (tx, fx) => {
    await tx
      .update(tenants)
      .set({
        websiteStatus: status,
        websiteSubscriptionId: state.subscriptionId,
        websiteCancelsAt: state.cancelsAt,
        // The add-on can be the first thing a business buys: its billing account starts here.
        billingCustomerId: tenant.billingCustomerId ?? state.customerId,
      })
      .where(eq(tenants.id, tenant.id));
    if (status !== tenant.websiteStatus || Boolean(state.cancelsAt) !== Boolean(tenant.websiteCancelsAt)) {
      await audit(tx, {
        tenantId: tenant.id,
        actor,
        action: "website.updated",
        entityType: "tenant",
        entityId: tenant.id,
        data: { from: tenant.websiteStatus, to: status, cancelsAt: state.cancelsAt },
      });
    }
    if (live !== wasLive) fx.enqueue(QUEUES.listingPush, { tenantId: tenant.id });
    fx.publish({ type: "account.updated" });
  });
  return true;
}

/** The provider's own page: the card, past bills, and cancelling at the end of the paid month. */
export async function billingPortal(tenantId: string, origin: string) {
  const tenant = await tenantOf(tenantId);
  if (!tenant.billingCustomerId) throw new HttpError(409, "no_billing", "Choose a plan first.");
  try {
    return { url: await billing.portalUrl(tenant.billingCustomerId, `${origin}/settings?billing=back#plan`) };
  } catch (error) {
    return refused(error);
  }
}

/**
 * The one place a subscription's news lands (checkout return, billing page, webhook, simulator):
 * the tier, the account status and the billing dates on the business. Returns false when it isn't
 * about any business here, or is an old subscription the business has since replaced.
 */
export async function applyTierSubscription(state: TierSubscription, actor: string): Promise<boolean> {
  if (!state.tenantId || state.status === "incomplete") return false;
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.id, state.tenantId));
  if (!tenant) return false;
  if (tenant.billingSubscriptionId && tenant.billingSubscriptionId !== state.subscriptionId && state.status === "canceled") {
    return false;
  }
  const status = state.status === "active" ? "active" : state.status === "past_due" ? "past_due" : "cancelled";
  await tenantWork(tenant.id, async (tx, fx) => {
    await tx
      .update(tenants)
      .set({
        status,
        tier: state.tier,
        billingCustomerId: state.customerId,
        billingSubscriptionId: state.subscriptionId,
        billingPeriodEnd: state.periodEnd,
        billingCancelsAt: state.cancelsAt,
      })
      .where(eq(tenants.id, tenant.id));
    if (status !== tenant.status || state.tier !== tenant.tier || Boolean(state.cancelsAt) !== Boolean(tenant.billingCancelsAt)) {
      await audit(tx, {
        tenantId: tenant.id,
        actor,
        action: "billing.updated",
        entityType: "tenant",
        entityId: tenant.id,
        data: { from: { status: tenant.status, tier: tenant.tier }, to: { status, tier: state.tier, cancelsAt: state.cancelsAt } },
      });
    }
    fx.publish({ type: "account.updated" });
    if (status === "active" || status === "past_due") {
      // C-25: a business that joined with another's link and now pays is that business's referral.
      const referrer = tenant.referredByTenantId;
      if (referrer) fx.afterCommit(() => recordReferral(referrer, "signup", tenant.id));
      // Free months earned on the trial come off the first bills.
      fx.afterCommit(() => applyReferralCredits(tenant.id));
    }
  });
  return true;
}

/** A webhook from the provider: kept once in the inbox, then applied (a tier, or the website add-on). */
export async function receiveBillingEvent(
  event: { id: string; type: string },
  read: () => Promise<TierSubscription | null>,
  readAddon: () => Promise<AddonSubscription | null> = async () => null,
) {
  const provider = `billing.${billing.name}`;
  const [stored] = await systemDb
    .insert(webhookInbox)
    .values({ provider, eventId: event.id, eventType: event.type, payload: event })
    .onConflictDoNothing()
    .returning({ id: webhookInbox.id });
  if (!stored) return;
  try {
    const state = await read();
    const addon = state ? null : await readAddon();
    const applied = state ? await applyTierSubscription(state, "billing") : addon ? await applyAddonSubscription(addon, "billing") : false;
    await systemDb
      .update(webhookInbox)
      .set({ status: applied ? "processed" : "ignored", tenantId: applied ? (state ?? addon)!.tenantId : null, processedAt: new Date() })
      .where(eq(webhookInbox.id, stored.id));
  } catch (error) {
    logger.error({ err: error, eventId: event.id }, "billing event failed");
    await systemDb
      .update(webhookInbox)
      .set({ status: "failed", error: (error as Error).message.slice(0, 500), processedAt: new Date() })
      .where(eq(webhookInbox.id, stored.id));
  }
}

/** Development: move the trial's end, to try what a business sees when it runs out. */
export async function setTrialDaysLeft(tenantId: string, daysLeft: number): Promise<BillingResponse> {
  await tenantWork(tenantId, async (tx, fx) => {
    await tx
      .update(tenants)
      .set({ trialEndsAt: new Date(Date.now() + daysLeft * 86_400_000) })
      .where(eq(tenants.id, tenantId));
    fx.publish({ type: "account.updated" });
  });
  return getBilling(tenantId);
}
