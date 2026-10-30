import Stripe from "stripe";
import type {
  AccountState,
  CheckoutInput,
  CheckoutSession,
  InvoiceState,
  PaymentEvent,
  PaymentState,
  PaymentsProvider,
  PriceInput,
  SubscriptionCheckoutInput,
  SubscriptionState,
} from "./types";
import { PaymentRefused } from "./types";

/**
 * Stripe Connect + Checkout + Billing (module 7 and module 12), in test mode until the platform
 * goes live. Each business gets its own Stripe account with its own dashboard ("Standard"), and
 * everything is created on that account (direct charges): the business is the merchant, its
 * customers and plans live in its Stripe, and card details never reach LeadAnchor.
 */
export class StripePayments implements PaymentsProvider {
  readonly name = "stripe" as const;
  private readonly stripe: Stripe;
  private readonly portalConfigs = new Map<string, string>();

  constructor(
    secretKey: string,
    private readonly webhookSecret: string | undefined,
  ) {
    this.stripe = new Stripe(secretKey, {
      appInfo: { name: "LeadAnchor" },
      maxNetworkRetries: 2,
      timeout: 20_000,
    });
  }

  /* ── The business's own account ─────────────────────────────────────────── */

  async createAccount(input: { tenantId: string; businessName: string; email: string | null }) {
    const account = await this.stripe.accounts
      .create(
        {
          controller: {
            stripe_dashboard: { type: "full" },
            fees: { payer: "account" },
            losses: { payments: "stripe" },
            requirement_collection: "stripe",
          },
          country: "US",
          ...(input.email ? { email: input.email } : {}),
          business_profile: { name: input.businessName },
          metadata: { tenantId: input.tenantId },
        },
        { idempotencyKey: `account:${input.tenantId}` },
      )
      .catch(refuse);
    return { accountId: account.id };
  }

  async onboardingUrl(accountId: string, urls: { returnUrl: string; refreshUrl: string }) {
    const link = await this.stripe.accountLinks
      .create({
        account: accountId,
        type: "account_onboarding",
        return_url: urls.returnUrl,
        refresh_url: urls.refreshUrl,
      })
      .catch(refuse);
    return link.url;
  }

  async getAccount(accountId: string): Promise<AccountState> {
    return accountStateOf(await this.stripe.accounts.retrieve(accountId).catch(refuse));
  }

  /* ── One-off payments: deposits (card holds) and pay links ─────────────── */

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions
      .create(
        {
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: input.amountCents,
                product_data: { name: input.description },
              },
            },
          ],
          // A hold (C-15) is a card authorisation, which only cards support.
          allowed_payment_method_types: ["card"],
          payment_intent_data: {
            capture_method: input.capture === "hold" ? "manual" : "automatic",
            description: input.description,
            metadata: { reference: input.reference },
          },
          ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
          client_reference_id: input.reference,
          metadata: { reference: input.reference },
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
        },
        { stripeAccount: input.accountId, idempotencyKey: input.idempotencyKey },
      )
      .catch(refuse);
    return {
      id: session.id,
      url: session.url ?? "",
      expiresAt: new Date(session.expires_at * 1000),
    };
  }

  async getPayment(accountId: string, checkoutId: string): Promise<PaymentState> {
    const session = await this.stripe.checkout.sessions
      .retrieve(
        checkoutId,
        { expand: ["payment_intent.latest_charge"] },
        { stripeAccount: accountId },
      )
      .catch(refuse);
    return paymentStateOf(session);
  }

  async capture(accountId: string, paymentId: string): Promise<PaymentState> {
    await this.stripe.paymentIntents
      .capture(paymentId, {}, { stripeAccount: accountId, idempotencyKey: `capture:${paymentId}` })
      .catch((error: unknown) => {
        if (stripeCode(error) === "payment_intent_unexpected_state")
          throw new PaymentRefused(
            "This hold has ended, so it can't be collected. Send the customer a new pay link.",
          );
        return refuse(error);
      });
    return this.paymentFor(accountId, paymentId);
  }

  async release(accountId: string, paymentId: string): Promise<PaymentState> {
    await this.stripe.paymentIntents
      .cancel(paymentId, {}, { stripeAccount: accountId, idempotencyKey: `release:${paymentId}` })
      .catch((error: unknown) => {
        if (stripeCode(error) === "payment_intent_unexpected_state")
          throw new PaymentRefused("This payment was already collected.");
        return refuse(error);
      });
    return this.paymentFor(accountId, paymentId);
  }

  async expireCheckout(accountId: string, checkoutId: string) {
    // Only an open checkout can be closed; one that's paid or already closed needs nothing.
    await this.stripe.checkout.sessions
      .expire(checkoutId, {}, { stripeAccount: accountId })
      .catch(() => undefined);
  }

  /** The checkout a payment came from: payment state is read through it, as for webhooks. */
  private async paymentFor(accountId: string, paymentId: string): Promise<PaymentState> {
    const sessions = await this.stripe.checkout.sessions
      .list(
        { payment_intent: paymentId, limit: 1, expand: ["data.payment_intent.latest_charge"] },
        { stripeAccount: accountId },
      )
      .catch(refuse);
    const session = sessions.data[0];
    if (!session) throw new PaymentRefused("Stripe has no checkout for that payment.");
    return paymentStateOf(session);
  }

  /* ── Billing: membership plans (module 12) ─────────────────────────────── */

  async createPrice(input: PriceInput): Promise<{ productId: string; priceId: string }> {
    const options = { stripeAccount: input.accountId };
    let productId = input.productId;
    if (!productId) {
      const product = await this.stripe.products
        .create(
          {
            name: input.name,
            ...(input.description ? { description: input.description } : {}),
          },
          { ...options, idempotencyKey: `${input.idempotencyKey}:product` },
        )
        .catch(refuse);
      productId = product.id;
    }
    const price = await this.stripe.prices
      .create(
        {
          product: productId,
          currency: "usd",
          unit_amount: input.amountCents,
          recurring: { interval: input.interval },
        },
        { ...options, idempotencyKey: `${input.idempotencyKey}:price` },
      )
      .catch(refuse);
    return { productId, priceId: price.id };
  }

  async createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions
      .create(
        {
          mode: "subscription",
          line_items: [{ price: input.priceId, quantity: 1 }],
          allowed_payment_method_types: ["card"],
          customer_email: input.customerEmail,
          client_reference_id: input.reference,
          metadata: { reference: input.reference },
          subscription_data: { metadata: { reference: input.reference } },
          // ROSCA (C-49 AC 1): the full terms sit right above the button that starts the charge.
          custom_text: { submit: { message: input.terms.join(" ").slice(0, 1200) } },
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
        },
        { stripeAccount: input.accountId, idempotencyKey: input.idempotencyKey },
      )
      .catch(refuse);
    return {
      id: session.id,
      url: session.url ?? "",
      expiresAt: new Date(session.expires_at * 1000),
    };
  }

  async subscriptionForCheckout(
    accountId: string,
    checkoutId: string,
  ): Promise<SubscriptionState | null> {
    const session = await this.stripe.checkout.sessions
      .retrieve(
        checkoutId,
        { expand: ["subscription.default_payment_method"] },
        { stripeAccount: accountId },
      )
      .catch(refuse);
    if (session.status !== "complete" || !session.subscription) return null;
    return typeof session.subscription === "string"
      ? this.getSubscription(accountId, session.subscription)
      : subscriptionStateOf(session.subscription);
  }

  async getSubscription(accountId: string, subscriptionId: string): Promise<SubscriptionState> {
    return subscriptionStateOf(
      await this.stripe.subscriptions
        .retrieve(
          subscriptionId,
          { expand: ["default_payment_method"] },
          { stripeAccount: accountId },
        )
        .catch(refuse),
    );
  }

  async pauseSubscription(accountId: string, subscriptionId: string) {
    // "void": bills that fall due while paused are dropped, so nothing is charged.
    return this.updateSubscription(accountId, subscriptionId, {
      pause_collection: { behavior: "void" },
    });
  }

  async resumeSubscription(accountId: string, subscriptionId: string) {
    return this.updateSubscription(accountId, subscriptionId, { pause_collection: "" });
  }

  async cancelSubscription(accountId: string, subscriptionId: string) {
    const options = { stripeAccount: accountId };
    const current = await this.stripe.subscriptions
      .retrieve(subscriptionId, {}, options)
      .catch(refuse);
    if (current.status === "canceled") return this.getSubscription(accountId, subscriptionId);
    // Owing money: there's no paid period left to run, so it ends now and Stripe stops chasing.
    if (["past_due", "unpaid", "incomplete"].includes(current.status)) {
      await this.stripe.subscriptions
        .cancel(subscriptionId, { invoice_now: false, prorate: false }, options)
        .catch(refuse);
      const open = await this.stripe.invoices
        .list({ subscription: subscriptionId, status: "open", limit: 10 }, options)
        .catch(refuse);
      for (const invoice of open.data)
        await this.stripe.invoices.voidInvoice(invoice.id, {}, options).catch(() => undefined);
      return this.getSubscription(accountId, subscriptionId);
    }
    return this.updateSubscription(accountId, subscriptionId, { cancel_at_period_end: true });
  }

  async changeSubscriptionPrice(accountId: string, subscriptionId: string, priceId: string) {
    const options = { stripeAccount: accountId };
    const current = await this.stripe.subscriptions
      .retrieve(subscriptionId, {}, options)
      .catch(refuse);
    const item = current.items.data[0];
    if (!item) throw new PaymentRefused("This membership has no plan on it to change.");
    // Bill (or credit) the difference for the rest of this period straight away.
    const updated = await this.stripe.subscriptions
      .update(
        subscriptionId,
        {
          items: [{ id: item.id, price: priceId }],
          proration_behavior: "always_invoice",
          expand: ["default_payment_method"],
        },
        options,
      )
      .catch(refuse);
    const latest = typeof updated.latest_invoice === "string" ? updated.latest_invoice : null;
    const invoice =
      latest &&
      latest !== (typeof current.latest_invoice === "string" ? current.latest_invoice : null)
        ? await this.invoiceState(accountId, latest)
        : null;
    // A move down leaves a credit for the next bill rather than a bill of its own.
    return {
      subscription: subscriptionStateOf(updated),
      invoice: invoice && invoice.amountCents > 0 ? invoice : null,
    };
  }

  async retryInvoice(accountId: string, invoiceId: string): Promise<InvoiceState> {
    await this.stripe.invoices
      .pay(invoiceId, {}, { stripeAccount: accountId })
      .catch((error: unknown) => {
        // A decline is an answer, not a failure: the bill's new state says so.
        if (error instanceof Stripe.errors.StripeCardError) return undefined;
        return refuse(error);
      });
    const state = await this.invoiceState(accountId, invoiceId);
    if (!state) throw new PaymentRefused("Stripe hasn't tried this bill yet.");
    return state;
  }

  async portalUrl(accountId: string, customerId: string, returnUrl: string) {
    const session = await this.stripe.billingPortal.sessions
      .create(
        {
          customer: customerId,
          return_url: returnUrl,
          configuration: await this.portalConfiguration(accountId),
        },
        { stripeAccount: accountId },
      )
      .catch(refuse);
    return session.url;
  }

  private async updateSubscription(
    accountId: string,
    subscriptionId: string,
    params: Stripe.SubscriptionUpdateParams,
  ): Promise<SubscriptionState> {
    return subscriptionStateOf(
      await this.stripe.subscriptions
        .update(
          subscriptionId,
          { ...params, expand: ["default_payment_method"] },
          { stripeAccount: accountId },
        )
        .catch(refuse),
    );
  }

  /** A bill, with the payment attempts that carry the decline message. Null until Stripe tries it. */
  private async invoiceState(accountId: string, invoiceId: string): Promise<InvoiceState | null> {
    const invoice = await this.stripe.invoices
      .retrieve(
        invoiceId,
        { expand: ["payments.data.payment.payment_intent"] },
        { stripeAccount: accountId },
      )
      .catch(refuse);
    return invoiceStateOf(invoice);
  }

  /**
   * The member's self-service page (C-52): update the card, see bills, cancel at the period's end
   * with no reason asked. Made once per business and found again by its tag.
   */
  private async portalConfiguration(accountId: string): Promise<string> {
    const cached = this.portalConfigs.get(accountId);
    if (cached) return cached;
    const options = { stripeAccount: accountId };
    const existing = await this.stripe.billingPortal.configurations
      .list({ active: true, limit: 20 }, options)
      .catch(refuse);
    const ours = existing.data.find((config) => config.metadata?.leadanchor === PORTAL_TAG);
    const id =
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
            { ...options, idempotencyKey: `portal:${accountId}` },
          )
          .catch(refuse)
      ).id;
    this.portalConfigs.set(accountId, id);
    return id;
  }

  /* ── Webhooks ───────────────────────────────────────────────────────────── */

  /** Checks Stripe's signature on a webhook delivery. Throws when it doesn't match. */
  verifyWebhook(rawBody: string, signature: string | undefined): Stripe.Event {
    if (!this.webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set.");
    if (!signature) throw new Error("Missing Stripe-Signature header.");
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  /**
   * What one Stripe event means for us. Events can arrive late, twice or out of order, so each
   * one reads the object's current state from Stripe rather than trusting the event's copy.
   */
  async eventsFrom(event: Stripe.Event): Promise<PaymentEvent[]> {
    const accountId = event.account;
    if (!accountId) return [];
    const type: string = event.type;

    if (type === "account.updated") {
      return [
        {
          id: event.id,
          type: "account",
          accountId,
          account: accountStateOf(event.data.object as Stripe.Account),
        },
      ];
    }
    if (type.startsWith("checkout.session.")) {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "payment") return [];
      return [
        {
          id: event.id,
          type: "payment",
          accountId,
          state: await this.getPayment(accountId, session.id),
        },
      ];
    }
    if (type.startsWith("payment_intent.")) {
      const intent = event.data.object as Stripe.PaymentIntent;
      // Membership bills have payment intents too; only checkout payments are ours to track here.
      const sessions = await this.stripe.checkout.sessions.list(
        { payment_intent: intent.id, limit: 1 },
        { stripeAccount: accountId },
      );
      const session = sessions.data[0];
      if (!session || session.mode !== "payment") return [];
      return [
        {
          id: event.id,
          type: "payment",
          accountId,
          state: await this.getPayment(accountId, session.id),
        },
      ];
    }
    if (type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as Stripe.Subscription;
      if (!subscription.metadata?.reference) return [];
      return [
        {
          id: event.id,
          type: "subscription",
          accountId,
          subscription: await this.getSubscription(accountId, subscription.id),
        },
      ];
    }
    if (type.startsWith("invoice.")) {
      const invoice = event.data.object as Stripe.Invoice;
      if (!invoice.id || !invoice.parent?.subscription_details) return [];
      const state = await this.invoiceState(accountId, invoice.id);
      return state ? [{ id: event.id, type: "invoice", accountId, invoice: state }] : [];
    }
    return [];
  }
}

const PORTAL_TAG = "member-portal";

/* ── Stripe objects → our states (pure, so they're tested without Stripe) ───── */

const toDate = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000) : null);

/** What Stripe still needs from the owner, in plain words. */
const REQUIREMENT_WORDS: Array<[RegExp, string]> = [
  [/^external_account/, "a bank account for payouts"],
  [/^tos_acceptance/, "accepting Stripe's terms"],
  [/verification\.document|verification\.additional_document/, "a photo of an ID"],
  [/ssn_last_4|id_number/, "an ID number (SSN or EIN)"],
  [/^business_profile\.(url|product_description)/, "a website or a description of the business"],
  [/^business_profile\.mcc/, "the kind of business"],
  [/^(company|business_type)/, "details about the business"],
  [/^(individual|representative|person_|owners|directors|executives)/, "details about the owner"],
];

export function accountStateOf(account: Stripe.Account): AccountState {
  const due = account.requirements?.currently_due ?? [];
  const requirements = [
    ...new Set(
      due.map(
        (key) =>
          REQUIREMENT_WORDS.find(([pattern]) => pattern.test(key))?.[1] ??
          "details Stripe asks for",
      ),
    ),
  ];
  return {
    status: account.charges_enabled
      ? "active"
      : account.details_submitted
        ? "restricted"
        : "onboarding",
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    requirements,
  };
}

export function paymentStateOf(session: Stripe.Checkout.Session): PaymentState {
  const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const charge = intent && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const card = charge?.payment_method_details?.card ?? null;
  const status: PaymentState["status"] =
    intent?.status === "requires_capture"
      ? "held"
      : intent?.status === "succeeded"
        ? "paid"
        : intent?.status === "canceled" && session.status === "complete"
          ? "released"
          : session.status === "expired"
            ? "expired"
            : "open";
  return {
    checkoutId: session.id,
    reference: session.metadata?.reference ?? session.client_reference_id ?? "",
    status,
    paymentId: intent?.id ?? null,
    amountCents: session.amount_total ?? 0,
    cardBrand: card?.brand ?? null,
    cardLast4: card?.last4 ?? null,
    // Card holds last about 7 days; Stripe says exactly when this one lapses.
    holdExpiresAt: status === "held" ? toDate(card?.capture_before) : null,
    failure: intent?.last_payment_error?.message ?? null,
  };
}

export function subscriptionStateOf(subscription: Stripe.Subscription): SubscriptionState {
  const item = subscription.items.data[0];
  const price = item?.price;
  const method =
    typeof subscription.default_payment_method === "object"
      ? subscription.default_payment_method
      : null;
  const status: SubscriptionState["status"] =
    subscription.status === "canceled" || subscription.status === "incomplete_expired"
      ? "canceled"
      : subscription.pause_collection || subscription.status === "paused"
        ? "paused"
        : subscription.status === "past_due" || subscription.status === "unpaid"
          ? "past_due"
          : "active";
  const periodEnd = toDate(item?.current_period_end);
  return {
    subscriptionId: subscription.id,
    customerId:
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    reference: subscription.metadata?.reference ?? "",
    priceId: price?.id ?? "",
    amountCents: price?.unit_amount ?? 0,
    interval: price?.recurring?.interval === "year" ? "year" : "month",
    status,
    currentPeriodEnd: status === "canceled" ? null : periodEnd,
    endsAt:
      toDate(subscription.cancel_at) ??
      (subscription.cancel_at_period_end ? periodEnd : null) ??
      toDate(subscription.ended_at),
    cardBrand: method?.card?.brand ?? null,
    cardLast4: method?.card?.last4 ?? null,
  };
}

/**
 * One bill. Null while it hasn't been tried (a draft, or finalised and waiting for its first
 * attempt), so a new bill is never mistaken for a declined one.
 */
export function invoiceStateOf(invoice: Stripe.Invoice): InvoiceState | null {
  if (!invoice.id || invoice.status === "draft") return null;
  if (invoice.status === "open" && invoice.attempt_count === 0) return null;
  const details = invoice.parent?.subscription_details;
  const subscription = details?.subscription;
  const line = invoice.lines?.data?.[0];
  const intents = (invoice.payments?.data ?? []).flatMap((payment) =>
    typeof payment.payment?.payment_intent === "object" ? [payment.payment.payment_intent] : [],
  );
  const declined = intents.find((intent) => intent.last_payment_error)?.last_payment_error?.message;
  const status: InvoiceState["status"] =
    invoice.status === "paid"
      ? "paid"
      : invoice.status === "open" && invoice.next_payment_attempt
        ? "retrying"
        : "failed";
  return {
    invoiceId: invoice.id,
    subscriptionId: typeof subscription === "string" ? subscription : (subscription?.id ?? ""),
    reference: details?.metadata?.reference ?? "",
    kind: invoice.billing_reason === "subscription_update" ? "proration" : "cycle",
    amountCents: invoice.amount_due,
    status,
    attempts: invoice.attempt_count,
    nextAttemptAt: status === "retrying" ? toDate(invoice.next_payment_attempt) : null,
    periodStart: toDate(line?.period?.start),
    periodEnd: toDate(line?.period?.end),
    paidAt: toDate(invoice.status_transitions?.paid_at),
    failure:
      status === "paid"
        ? null
        : invoice.status === "void"
          ? "Cancelled before it was paid."
          : (declined ?? "Your card was declined."),
  };
}

const stripeCode = (error: unknown) =>
  error instanceof Stripe.errors.StripeError ? error.code : undefined;

/** Stripe said no: pass its reason on in words the owner can act on. */
function refuse(error: unknown): never {
  if (error instanceof Stripe.errors.StripeCardError)
    throw new PaymentRefused(error.message || "The card was declined.");
  if (error instanceof Stripe.errors.StripeInvalidRequestError)
    throw new PaymentRefused(`Stripe refused that: ${error.message}`);
  if (error instanceof Stripe.errors.StripeAuthenticationError)
    throw new PaymentRefused("Stripe didn't accept LeadAnchor's key. Check STRIPE_SECRET_KEY.");
  throw error;
}
