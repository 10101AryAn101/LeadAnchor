import { TIERS, TIER_DETAILS, type Tier, WEBSITE_ADDON } from "@leadanchor/contracts";
import Stripe from "stripe";
import { PaymentRefused } from "../payments/types";
import {
  type AddonCheckoutInput,
  type AddonSubscription,
  type BillingProvider,
  MIN_TRIAL_LEFT_MS,
  type TierCheckoutInput,
  type TierSubscription,
} from "./types";

const PORTAL_TAG = "tier-portal";
/** Marks the website add-on's subscription (C-33), so it's never read as a tier. */
const WEBSITE = "website";
/** How a tier subscription is named on Stripe's billing page and bills. */
const planDescription = (tier: Tier, businessName: string) => `LeadAnchor ${TIER_DETAILS[tier].name} for ${businessName}`;

/**
 * LeadAnchor's own subscriptions on LeadAnchor's Stripe account (no stripeAccount header: these
 * are LeadAnchor's customers, unlike the payments provider's). Each tier's monthly price is made
 * the first time it's needed and found again by its lookup key, so a fresh test account just works.
 */
export class StripeBilling implements BillingProvider {
  readonly name = "stripe" as const;
  private readonly stripe: Stripe;
  private readonly prices = new Map<Tier, string>();
  private portalConfig: string | null = null;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string | undefined,
  ) {
    this.stripe = new Stripe(secretKey, { appInfo: { name: "LeadAnchor" }, maxNetworkRetries: 2, timeout: 20_000 });
  }

  async checkout(input: TierCheckoutInput) {
    const trialEnd =
      input.trialEndsAt && input.trialEndsAt.getTime() - Date.now() >= MIN_TRIAL_LEFT_MS
        ? Math.floor(input.trialEndsAt.getTime() / 1000)
        : undefined;
    const metadata = { tenantId: input.tenantId, tier: input.tier };
    const session = await this.stripe.checkout.sessions
      .create({
        mode: "subscription",
        line_items: [{ price: await this.priceOf(input.tier), quantity: 1 }],
        ...(input.customerId ? { customer: input.customerId } : { customer_email: input.email }),
        client_reference_id: input.tenantId,
        metadata,
        subscription_data: {
          metadata,
          description: planDescription(input.tier, input.businessName),
          ...(trialEnd && { trial_end: trialEnd }),
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      })
      .catch(refuse);
    if (!session.url) throw new PaymentRefused("Stripe didn't return a checkout page.");
    return { url: session.url, checkoutId: session.id };
  }

  async subscriptionForCheckout(checkoutId: string) {
    const session = await this.stripe.checkout.sessions.retrieve(checkoutId, { expand: ["subscription"] }).catch(refuse);
    if (session.status !== "complete" || !session.subscription || typeof session.subscription === "string") return null;
    return tierSubscriptionOf(session.subscription);
  }

  async getSubscription(subscriptionId: string) {
    return tierSubscriptionOf(await this.stripe.subscriptions.retrieve(subscriptionId).catch(refuse));
  }

  async changeTier(subscriptionId: string, tier: Tier, businessName: string) {
    const current = await this.stripe.subscriptions.retrieve(subscriptionId).catch(refuse);
    const item = current.items.data[0];
    if (!item) throw new PaymentRefused("That subscription has nothing on it to change.");
    const updated = await this.stripe.subscriptions
      .update(subscriptionId, {
        items: [{ id: item.id, price: await this.priceOf(tier) }],
        metadata: { ...current.metadata, tier },
        // Stripe's billing page shows this under the plan, so it follows the new tier.
        description: planDescription(tier, businessName),
        // Picking a tier again means keeping it, so a pending cancellation is undone.
        cancel_at_period_end: false,
        // Charge or credit the difference now; nothing to settle while the trial is still free.
        proration_behavior: current.status === "trialing" ? "none" : "always_invoice",
      })
      .catch(refuse);
    return tierSubscriptionOf(updated);
  }

  async portalUrl(customerId: string, returnUrl: string) {
    const session = await this.stripe.billingPortal.sessions
      .create({ customer: customerId, return_url: returnUrl, configuration: await this.portalConfiguration() })
      .catch(refuse);
    return session.url;
  }

  async addCredit(customerId: string, cents: number, reason: string, key: string) {
    // A negative balance is credit: Stripe takes it off the next invoices by itself.
    await this.stripe.customers
      .createBalanceTransaction(customerId, { amount: -cents, currency: "usd", description: reason }, { idempotencyKey: key })
      .catch(refuse);
  }

  async creditCents(customerId: string) {
    const customer = await this.stripe.customers.retrieve(customerId).catch(refuse);
    return "deleted" in customer && customer.deleted ? 0 : Math.max(0, -(customer.balance ?? 0));
  }

  async addonCheckout(input: AddonCheckoutInput) {
    const metadata = { tenantId: input.tenantId, product: WEBSITE };
    const [hosting, setup] = await Promise.all([this.addonPrice("hosting"), this.addonPrice("setup")]);
    const session = await this.stripe.checkout.sessions
      .create({
        mode: "subscription",
        // The one-time setup fee rides on the first invoice of the hosting subscription.
        line_items: [
          { price: hosting, quantity: 1 },
          { price: setup, quantity: 1 },
        ],
        ...(input.customerId ? { customer: input.customerId } : { customer_email: input.email }),
        client_reference_id: input.tenantId,
        metadata,
        subscription_data: { metadata, description: `${WEBSITE_ADDON.name} for ${input.businessName}` },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      })
      .catch(refuse);
    if (!session.url) throw new PaymentRefused("Stripe didn't return a checkout page.");
    return { url: session.url, checkoutId: session.id };
  }

  async addonForCheckout(checkoutId: string) {
    const session = await this.stripe.checkout.sessions.retrieve(checkoutId, { expand: ["subscription"] }).catch(refuse);
    if (session.status !== "complete" || !session.subscription || typeof session.subscription === "string") return null;
    return session.subscription.metadata?.product === WEBSITE ? addonOf(session.subscription) : null;
  }

  async getAddon(subscriptionId: string) {
    return addonOf(await this.stripe.subscriptions.retrieve(subscriptionId).catch(refuse));
  }

  async setAddonCancel(subscriptionId: string, cancel: boolean) {
    return addonOf(await this.stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: cancel }).catch(refuse));
  }

  /** The website add-on's subscription an event is about, if it is one (C-33). */
  async addonFrom(event: Stripe.Event): Promise<AddonSubscription | null> {
    if (event.account) return null;
    if (event.type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as Stripe.Subscription;
      return subscription.metadata?.product === WEBSITE && subscription.metadata.tenantId ? addonOf(subscription) : null;
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      return session.metadata?.product === WEBSITE ? this.addonForCheckout(session.id) : null;
    }
    return null;
  }

  verifyWebhook(rawBody: string, signature: string): Stripe.Event {
    if (!this.webhookSecret) throw new Error("STRIPE_BILLING_WEBHOOK_SECRET is not set.");
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  /** The subscription an event from LeadAnchor's own account is about, if it's one of ours. */
  async subscriptionFrom(event: Stripe.Event): Promise<TierSubscription | null> {
    if (event.account) return null;
    if (event.type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as Stripe.Subscription;
      // The website add-on has its own subscription (C-33): never a tier.
      return subscription.metadata?.tenantId && subscription.metadata.product !== WEBSITE ? tierSubscriptionOf(subscription) : null;
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      return session.mode === "subscription" && session.metadata?.tenantId && session.metadata.product !== WEBSITE
        ? this.subscriptionForCheckout(session.id)
        : null;
    }
    return null;
  }

  private async priceOf(tier: Tier): Promise<string> {
    const cached = this.prices.get(tier);
    if (cached) return cached;
    const { name, priceCents } = TIER_DETAILS[tier];
    const lookupKey = `leadanchor_${tier}_${priceCents}_monthly`;
    const found = await this.stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 }).catch(refuse);
    const id =
      found.data[0]?.id ??
      (
        await this.stripe.prices
          .create(
            {
              currency: "usd",
              unit_amount: priceCents,
              recurring: { interval: "month" },
              lookup_key: lookupKey,
              product_data: { name: `LeadAnchor ${name}`, metadata: { leadanchor: "tier", tier } },
              metadata: { tier },
            },
            { idempotencyKey: `tier-price:${lookupKey}` },
          )
          .catch(refuse)
      ).id;
    this.prices.set(tier, id);
    return id;
  }

  /** The website add-on's two prices: hosting each month, and the one-time setup. Made once, found by lookup key. */
  private async addonPrice(kind: "hosting" | "setup"): Promise<string> {
    const lookupKey =
      kind === "hosting" ? `leadanchor_website_hosting_${WEBSITE_ADDON.monthlyCents}_monthly` : `leadanchor_website_setup_${WEBSITE_ADDON.setupCents}_once`;
    const found = await this.stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 }).catch(refuse);
    if (found.data[0]) return found.data[0].id;
    const created = await this.stripe.prices
      .create(
        {
          currency: "usd",
          unit_amount: kind === "hosting" ? WEBSITE_ADDON.monthlyCents : WEBSITE_ADDON.setupCents,
          ...(kind === "hosting" && { recurring: { interval: "month" as const } }),
          lookup_key: lookupKey,
          product_data: {
            name: kind === "hosting" ? `${WEBSITE_ADDON.name}: hosting` : `${WEBSITE_ADDON.name}: setup`,
            metadata: { leadanchor: WEBSITE },
          },
        },
        { idempotencyKey: `addon-price:${lookupKey}` },
      )
      .catch(refuse);
    return created.id;
  }

  /** The billing page for a business's own subscription: card, past bills, cancel at the period's end. */
  private async portalConfiguration(): Promise<string> {
    if (this.portalConfig) return this.portalConfig;
    const existing = await this.stripe.billingPortal.configurations.list({ active: true, limit: 20 }).catch(refuse);
    const ours = existing.data.find((config) => config.metadata?.leadanchor === PORTAL_TAG);
    this.portalConfig =
      ours?.id ??
      (
        await this.stripe.billingPortal.configurations
          .create(
            {
              features: {
                payment_method_update: { enabled: true },
                invoice_history: { enabled: true },
                subscription_cancel: { enabled: true, mode: "at_period_end" },
              },
              metadata: { leadanchor: PORTAL_TAG },
            },
            { idempotencyKey: `portal:${PORTAL_TAG}` },
          )
          .catch(refuse)
      ).id;
    return this.portalConfig;
  }
}

export function tierSubscriptionOf(subscription: Stripe.Subscription): TierSubscription {
  const item = subscription.items.data[0];
  const named = subscription.metadata?.tier ?? item?.price?.metadata?.tier;
  const tier = (TIERS as readonly string[]).includes(named ?? "") ? (named as Tier) : "starter";
  const status: TierSubscription["status"] =
    subscription.status === "canceled" || subscription.status === "incomplete_expired"
      ? "canceled"
      : subscription.status === "past_due" || subscription.status === "unpaid"
        ? "past_due"
        : subscription.status === "incomplete"
          ? "incomplete"
          : "active";
  const periodEnd = toDate(item?.current_period_end);
  return {
    subscriptionId: subscription.id,
    customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    tenantId: subscription.metadata?.tenantId ?? "",
    tier,
    status,
    periodEnd: status === "canceled" ? null : periodEnd,
    cancelsAt: toDate(subscription.cancel_at) ?? (subscription.cancel_at_period_end ? periodEnd : null),
  };
}

const toDate = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000) : null);

export function addonOf(subscription: Stripe.Subscription): AddonSubscription {
  const { tenantId, status, cancelsAt } = tierSubscriptionOf(subscription);
  return {
    subscriptionId: subscription.id,
    customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    tenantId,
    status,
    cancelsAt,
  };
}

/** Stripe said no: pass its reason on in words the owner can act on. */
function refuse(error: unknown): never {
  if (error instanceof Stripe.errors.StripeCardError) throw new PaymentRefused(error.message || "The card was declined.");
  if (error instanceof Stripe.errors.StripeInvalidRequestError) throw new PaymentRefused(`Stripe refused that: ${error.message}`);
  if (error instanceof Stripe.errors.StripeAuthenticationError)
    throw new PaymentRefused("Stripe didn't accept LeadAnchor's key. Check STRIPE_SECRET_KEY.");
  throw error;
}
