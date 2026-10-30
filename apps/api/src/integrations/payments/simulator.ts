import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CARD_HOLD_DAYS, type PaymentCapture, type PlanInterval } from "@leadanchor/contracts";
import {
  type AccountState,
  type CheckoutInput,
  type CheckoutSession,
  type InvoiceState,
  type PaymentEvent,
  PaymentRefused,
  type PaymentState,
  type PaymentsProvider,
  type PriceInput,
  type SubscriptionCheckoutInput,
  type SubscriptionState,
} from "./types";

interface SimAccount {
  id: string;
  businessName: string;
  status: "onboarding" | "active" | "restricted";
  returnUrl: string | null;
  createdAt: string;
}

interface SimCheckout {
  id: string;
  accountId: string;
  reference: string;
  idempotencyKey: string;
  amountCents: number;
  description: string;
  businessName: string;
  capture: PaymentCapture;
  successUrl: string;
  cancelUrl: string;
  status: "open" | "complete" | "expired";
  paymentId: string | null;
  failure: string | null;
  expiresAt: string;
  createdAt: string;
  /** Subscription checkouts (memberships); older one-time checkouts have no mode. */
  mode?: "payment" | "subscription";
  priceId?: string;
  interval?: PlanInterval;
  terms?: string[];
  customerEmail?: string | null;
  subscriptionId?: string | null;
}

interface SimPayment {
  id: string;
  accountId: string;
  checkoutId: string;
  amountCents: number;
  status: "requires_capture" | "succeeded" | "canceled";
  holdExpiresAt: string | null;
}

interface SimProduct {
  id: string;
  accountId: string;
  name: string;
  description: string;
  createdAt: string;
}

interface SimPrice {
  id: string;
  accountId: string;
  productId: string;
  amountCents: number;
  interval: PlanInterval;
  idempotencyKey: string;
  createdAt: string;
}

interface SimSubscription {
  id: string;
  accountId: string;
  customerId: string;
  reference: string;
  priceId: string;
  amountCents: number;
  interval: PlanInterval;
  status: "active" | "past_due" | "paused" | "canceled";
  periodStart: string;
  periodEnd: string;
  /** Cancelled: it ends here. */
  cancelAt: string | null;
  card: { brand: string; last4: string };
  /** Development: the card on file declines until it's replaced in the portal. */
  cardFails: boolean;
  /** Left over from a move to a cheaper plan; taken off the next bill. */
  creditCents: number;
  createdAt: string;
}

interface SimInvoice {
  id: string;
  accountId: string;
  subscriptionId: string;
  kind: "cycle" | "proration";
  amountCents: number;
  status: "paid" | "open" | "void";
  attempts: number;
  nextAttemptAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  failure: string | null;
  createdAt: string;
}

interface SimPortalSession {
  id: string;
  accountId: string;
  customerId: string;
  returnUrl: string;
  createdAt: string;
}

interface Store {
  accounts: Record<string, SimAccount>;
  checkouts: Record<string, SimCheckout>;
  payments: Record<string, SimPayment>;
  products: Record<string, SimProduct>;
  prices: Record<string, SimPrice>;
  subscriptions: Record<string, SimSubscription>;
  invoices: Record<string, SimInvoice>;
  portals: Record<string, SimPortalSession>;
}

/** Stripe's test card: every simulated payment uses it, so no card number is ever typed. */
const TEST_CARD = { brand: "visa", last4: "4242" };
const CHECKOUT_TTL_MS = 24 * 3600_000;
const SETUP_STEPS = ["Add the bank account your payouts go to", "Confirm your identity"];
/** Stripe's test Mastercard: what a member swaps in through the portal. */
const NEW_CARD = { brand: "mastercard", last4: "4444" };
/**
 * After a decline Stripe tries again 3, 5 and 7 days later, then stops: the bill stays open and
 * the subscription past due (never cancelled by itself), so a new card or a retry still collects it.
 */
export const RETRY_DAYS = [3, 5, 7];
const DECLINED = "Your card was declined.";
const DAY_MS = 86_400_000;

const addInterval = (iso: string, interval: PlanInterval) => {
  const date = new Date(iso);
  if (interval === "month") date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString();
};

const newId = (prefix: string) => `${prefix}_sim_${randomBytes(9).toString("hex")}`;

/**
 * A stand-in for Stripe while no Stripe account is connected. It keeps the same objects
 * (connected accounts, hosted checkouts, payments that are held then collected or released),
 * hosts its pages under /sim/stripe on the web app, and reports back through the same
 * events a Stripe webhook would. State is kept in a file, so payments survive restarts.
 */
export class SimulatorPayments implements PaymentsProvider {
  readonly name = "simulator" as const;
  private cache: Store | null = null;

  constructor(
    private readonly file: string,
    private readonly pageBase: string,
  ) {}

  async createAccount(input: { businessName: string }) {
    const account: SimAccount = {
      id: newId("acct"),
      businessName: input.businessName,
      status: "onboarding",
      returnUrl: null,
      createdAt: new Date().toISOString(),
    };
    this.write((store) => (store.accounts[account.id] = account));
    return { accountId: account.id };
  }

  async onboardingUrl(accountId: string, urls: { returnUrl: string }) {
    this.write((store) => (this.account(store, accountId).returnUrl = urls.returnUrl));
    // The owner's own web address, so the round trip keeps them signed in.
    return `${new URL(urls.returnUrl).origin}/sim/stripe/onboarding/${accountId}`;
  }

  async getAccount(accountId: string): Promise<AccountState> {
    return accountState(this.account(this.read(), accountId));
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const store = this.read();
    const account = this.account(store, input.accountId);
    if (account.status !== "active")
      throw new PaymentRefused("Card payments aren't set up for this business yet.");
    const existing = Object.values(store.checkouts).find(
      (checkout) => checkout.idempotencyKey === input.idempotencyKey,
    );
    if (existing)
      return {
        id: existing.id,
        url: this.checkoutUrl(existing.id),
        expiresAt: new Date(existing.expiresAt),
      };

    const checkout: SimCheckout = {
      id: newId("cs"),
      accountId: input.accountId,
      reference: input.reference,
      idempotencyKey: input.idempotencyKey,
      amountCents: input.amountCents,
      description: input.description,
      businessName: input.businessName,
      capture: input.capture,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      status: "open",
      paymentId: null,
      failure: null,
      expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS).toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.write((draft) => (draft.checkouts[checkout.id] = checkout));
    return {
      id: checkout.id,
      url: this.checkoutUrl(checkout.id),
      expiresAt: new Date(checkout.expiresAt),
    };
  }

  async getPayment(accountId: string, checkoutId: string): Promise<PaymentState> {
    const store = this.read();
    const checkout = store.checkouts[checkoutId];
    if (!checkout || checkout.accountId !== accountId)
      throw new PaymentRefused("That checkout doesn't exist.");
    return stateOf(checkout, checkout.paymentId ? store.payments[checkout.paymentId] : undefined);
  }

  async capture(accountId: string, paymentId: string): Promise<PaymentState> {
    return this.updatePayment(accountId, paymentId, (payment) => {
      if (payment.status === "canceled")
        throw new PaymentRefused(
          "This hold has ended, so it can't be collected. Send the customer a new pay link.",
        );
      payment.status = "succeeded";
    });
  }

  async release(accountId: string, paymentId: string): Promise<PaymentState> {
    return this.updatePayment(accountId, paymentId, (payment) => {
      if (payment.status === "succeeded")
        throw new PaymentRefused("This payment was already collected.");
      payment.status = "canceled";
    });
  }

  async expireCheckout(accountId: string, checkoutId: string) {
    this.write((store) => {
      const checkout = store.checkouts[checkoutId];
      if (checkout && checkout.accountId === accountId && checkout.status === "open")
        checkout.status = "expired";
    });
  }

  /* ── The simulated hosted pages (development only) ─────────────────────── */

  checkoutView(checkoutId: string) {
    const store = this.read();
    const checkout = store.checkouts[checkoutId];
    if (!checkout) return null;
    const state = stateOf(
      checkout,
      checkout.paymentId ? store.payments[checkout.paymentId] : undefined,
    );
    return {
      id: checkout.id,
      businessName: checkout.businessName,
      description: checkout.description,
      amountCents: checkout.amountCents,
      capture: checkout.capture,
      status:
        checkout.mode === "subscription"
          ? checkout.status === "complete"
            ? ("complete" as const)
            : Date.parse(checkout.expiresAt) <= Date.now() || checkout.status === "expired"
              ? ("expired" as const)
              : ("open" as const)
          : state.status === "open"
            ? ("open" as const)
            : state.status === "expired"
              ? ("expired" as const)
              : ("complete" as const),
      lastFailure: checkout.failure,
      mode: checkout.mode ?? ("payment" as const),
      interval: checkout.interval ?? null,
      terms: checkout.terms ?? [],
    };
  }

  /** The customer's choice on the simulated checkout page, and the events Stripe would send for it. */
  completeCheckout(
    checkoutId: string,
    outcome: "pay" | "decline" | "cancel",
  ): { redirectUrl: string | null; events: PaymentEvent[] } {
    const store = this.read();
    const checkout = store.checkouts[checkoutId];
    if (!checkout) throw new PaymentRefused("That checkout doesn't exist.");
    if (outcome === "cancel") return { redirectUrl: checkout.cancelUrl, events: [] };
    if (checkout.mode === "subscription") return this.completeSubscriptionCheckout(checkout, outcome);
    const current = stateOf(
      checkout,
      checkout.paymentId ? store.payments[checkout.paymentId] : undefined,
    );
    if (current.status !== "open") return { redirectUrl: checkout.successUrl, events: [] };

    if (outcome === "decline") {
      this.write(
        (draft) =>
          (draft.checkouts[checkoutId]!.failure = "Your card was declined. Try another card."),
      );
      return { redirectUrl: null, events: [this.paymentEvent(checkoutId)] };
    }

    const payment: SimPayment = {
      id: newId("pi"),
      accountId: checkout.accountId,
      checkoutId,
      amountCents: checkout.amountCents,
      status: checkout.capture === "hold" ? "requires_capture" : "succeeded",
      holdExpiresAt:
        checkout.capture === "hold"
          ? new Date(Date.now() + CARD_HOLD_DAYS * 86_400_000).toISOString()
          : null,
    };
    this.write((draft) => {
      draft.payments[payment.id] = payment;
      draft.checkouts[checkoutId]!.status = "complete";
      draft.checkouts[checkoutId]!.paymentId = payment.id;
      draft.checkouts[checkoutId]!.failure = null;
    });
    return { redirectUrl: checkout.successUrl, events: [this.paymentEvent(checkoutId)] };
  }

  onboardingView(accountId: string) {
    const account = this.read().accounts[accountId];
    return account
      ? { id: account.id, businessName: account.businessName, status: account.status }
      : null;
  }

  completeOnboarding(
    accountId: string,
    outcome: "finish" | "later",
  ): { redirectUrl: string; event: PaymentEvent | null } {
    const store = this.read();
    const account = this.account(store, accountId);
    const redirectUrl = account.returnUrl ?? `${this.pageBase}/settings#payments`;
    if (outcome === "later" || account.status === "active") return { redirectUrl, event: null };
    this.write((draft) => (this.account(draft, accountId).status = "active"));
    return {
      redirectUrl,
      event: {
        id: newId("evt"),
        type: "account",
        accountId,
        account: accountState({ ...account, status: "active" }),
      },
    };
  }

  /** Moves a hold's end date close (or past), to try the "hold ends tomorrow" warning without waiting a week. */
  ageHold(paymentId: string, hoursLeft: number) {
    this.write((store) => {
      const payment = store.payments[paymentId];
      if (payment?.holdExpiresAt)
        payment.holdExpiresAt = new Date(Date.now() + hoursLeft * 3600_000).toISOString();
    });
  }


  /* ── Billing: products, prices, subscriptions, invoices and the portal ──── */

  async createPrice(input: PriceInput) {
    const store = this.read();
    this.account(store, input.accountId);
    const existing = Object.values(store.prices).find((price) => price.idempotencyKey === input.idempotencyKey);
    if (existing) return { productId: existing.productId, priceId: existing.id };
    const productId = input.productId && store.products[input.productId] ? input.productId : newId("prod");
    const price: SimPrice = {
      id: newId("price"),
      accountId: input.accountId,
      productId,
      amountCents: input.amountCents,
      interval: input.interval,
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date().toISOString(),
    };
    this.write((draft) => {
      draft.products[productId] = {
        id: productId,
        accountId: input.accountId,
        name: input.name,
        description: input.description,
        createdAt: draft.products[productId]?.createdAt ?? new Date().toISOString(),
      };
      draft.prices[price.id] = price;
    });
    return { productId, priceId: price.id };
  }

  async createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<CheckoutSession> {
    const store = this.read();
    const account = this.account(store, input.accountId);
    if (account.status !== "active") throw new PaymentRefused("Card payments aren't set up for this business yet.");
    const price = store.prices[input.priceId];
    if (!price || price.accountId !== input.accountId) throw new PaymentRefused("That plan's price doesn't exist.");
    const existing = Object.values(store.checkouts).find((checkout) => checkout.idempotencyKey === input.idempotencyKey);
    // Hosted on the customer's own address, like the page they came from.
    const origin = new URL(input.successUrl).origin;
    if (existing) return { id: existing.id, url: this.checkoutUrl(existing.id, origin), expiresAt: new Date(existing.expiresAt) };
    const checkout: SimCheckout = {
      id: newId("cs"),
      accountId: input.accountId,
      reference: input.reference,
      idempotencyKey: input.idempotencyKey,
      amountCents: price.amountCents,
      description: input.planName,
      businessName: input.businessName,
      capture: "charge",
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      status: "open",
      paymentId: null,
      failure: null,
      expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS).toISOString(),
      createdAt: new Date().toISOString(),
      mode: "subscription",
      priceId: price.id,
      interval: price.interval,
      terms: input.terms,
      customerEmail: input.customerEmail,
      subscriptionId: null,
    };
    this.write((draft) => (draft.checkouts[checkout.id] = checkout));
    return { id: checkout.id, url: this.checkoutUrl(checkout.id, origin), expiresAt: new Date(checkout.expiresAt) };
  }

  async subscriptionForCheckout(accountId: string, checkoutId: string) {
    const store = this.read();
    const checkout = store.checkouts[checkoutId];
    if (!checkout || checkout.accountId !== accountId) throw new PaymentRefused("That checkout doesn't exist.");
    const subscription = checkout.subscriptionId ? store.subscriptions[checkout.subscriptionId] : undefined;
    return subscription ? subscriptionState(subscription) : null;
  }

  async getSubscription(accountId: string, subscriptionId: string) {
    return subscriptionState(this.subscription(this.read(), accountId, subscriptionId));
  }

  async pauseSubscription(accountId: string, subscriptionId: string) {
    return this.updateSubscription(accountId, subscriptionId, (subscription) => {
      if (subscription.status === "canceled" || subscription.cancelAt) throw new PaymentRefused("This membership is cancelled.");
      subscription.status = "paused";
    });
  }

  async resumeSubscription(accountId: string, subscriptionId: string) {
    return this.updateSubscription(accountId, subscriptionId, (subscription) => {
      if (subscription.status !== "paused") throw new PaymentRefused("This membership isn't paused.");
      subscription.status = "active";
      // Billing picks up at the next period end, not with a catch-up charge.
      while (Date.parse(subscription.periodEnd) <= Date.now()) {
        subscription.periodStart = subscription.periodEnd;
        subscription.periodEnd = addInterval(subscription.periodEnd, subscription.interval);
      }
    });
  }

  async cancelSubscription(accountId: string, subscriptionId: string) {
    let state: SubscriptionState | null = null;
    this.write((store) => {
      const subscription = this.subscription(store, accountId, subscriptionId);
      cancel(store, subscription);
      state = subscriptionState(subscription);
    });
    return state!;
  }

  async changeSubscriptionPrice(accountId: string, subscriptionId: string, priceId: string) {
    let result: { subscription: SubscriptionState; invoice: InvoiceState | null } | null = null;
    this.write((store) => {
      const subscription = this.subscription(store, accountId, subscriptionId);
      const price = store.prices[priceId];
      if (!price || price.accountId !== accountId) throw new PaymentRefused("That plan's price doesn't exist.");
      if (subscription.status !== "active" || subscription.cancelAt)
        throw new PaymentRefused("Only an active membership can move to another plan.");
      if (price.interval !== subscription.interval)
        throw new PaymentRefused("That plan bills on a different schedule. Cancel this one and have them join it instead.");
      const now = Date.now();
      const start = Date.parse(subscription.periodStart);
      const end = Date.parse(subscription.periodEnd);
      // Stripe's proration: the unused part of this period at the new price, less the same at the old.
      const left = Math.max(0, Math.min(1, (end - now) / Math.max(1, end - start)));
      const difference = Math.round((price.amountCents - subscription.amountCents) * left);
      subscription.priceId = price.id;
      subscription.amountCents = price.amountCents;
      let invoice: SimInvoice | null = null;
      if (difference > 0) {
        invoice = newInvoice(subscription, "proration", difference, new Date(now).toISOString(), subscription.periodEnd);
        store.invoices[invoice.id] = invoice;
        attempt(store, subscription, invoice, now);
      } else if (difference < 0) subscription.creditCents += -difference;
      result = { subscription: subscriptionState(subscription), invoice: invoice ? invoiceState(invoice, subscription) : null };
    });
    return result!;
  }

  async retryInvoice(accountId: string, invoiceId: string) {
    let state: InvoiceState | null = null;
    this.write((store) => {
      const invoice = store.invoices[invoiceId];
      if (!invoice || invoice.accountId !== accountId) throw new PaymentRefused("That bill doesn't exist.");
      if (invoice.status !== "open") throw new PaymentRefused(invoice.status === "paid" ? "That bill is already paid." : "That bill is closed.");
      const subscription = store.subscriptions[invoice.subscriptionId]!;
      attempt(store, subscription, invoice, Date.now());
      state = invoiceState(invoice, subscription);
    });
    return state!;
  }

  async portalUrl(accountId: string, customerId: string, returnUrl: string) {
    const session: SimPortalSession = { id: newId("bps"), accountId, customerId, returnUrl, createdAt: new Date().toISOString() };
    this.write((store) => (store.portals[session.id] = session));
    // The member's own address, like the page they came from.
    return `${new URL(returnUrl).origin}/sim/stripe/portal/${session.id}`;
  }

  /* ── Billing, development only: the portal page, and time passing ──────── */

  portalView(sessionId: string) {
    const store = this.read();
    const session = store.portals[sessionId];
    const subscription = session && this.customerSubscription(store, session.customerId);
    if (!session || !subscription) return null;
    const price = store.prices[subscription.priceId];
    const product = price ? store.products[price.productId] : undefined;
    return {
      id: session.id,
      businessName: store.accounts[session.accountId]?.businessName ?? "",
      returnUrl: session.returnUrl,
      plan: { name: product?.name ?? "Membership", priceCents: subscription.amountCents, interval: subscription.interval },
      status: subscription.cancelAt ? ("canceled" as const) : subscription.status,
      currentPeriodEnd: subscription.cancelAt ?? subscription.periodEnd,
      card: { ...subscription.card, failing: subscription.cardFails },
      invoices: Object.values(store.invoices)
        .filter((invoice) => invoice.subscriptionId === subscription.id && invoice.status !== "void")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((invoice) => ({
          id: invoice.id,
          amountCents: invoice.amountCents,
          status: invoice.status === "paid" ? ("paid" as const) : invoice.nextAttemptAt ? ("open" as const) : ("uncollectible" as const),
          date: invoice.paidAt ?? invoice.createdAt,
        })),
    };
  }

  /** The member's choice in the simulated portal, and the events Stripe would send for it. */
  portalAction(sessionId: string, action: "cancel" | "update_card"): PaymentEvent[] {
    const events: PaymentEvent[] = [];
    this.write((store) => {
      const session = store.portals[sessionId];
      const subscription = session && this.customerSubscription(store, session.customerId);
      if (!session || !subscription) throw new PaymentRefused("This page has expired. Open the link in your receipt again.");
      if (action === "cancel") {
        events.push(...cancel(store, subscription).map((invoice) => invoiceEvent(invoice, subscription)));
      } else {
        subscription.card = { ...NEW_CARD };
        subscription.cardFails = false;
        // A new card pays what's outstanding straight away.
        for (const invoice of Object.values(store.invoices))
          if (invoice.subscriptionId === subscription.id && invoice.status === "open") {
            attempt(store, subscription, invoice, Date.now());
            events.push(invoiceEvent(invoice, subscription));
          }
      }
      events.unshift(subscriptionEvent(subscription));
    });
    return events;
  }

  /**
   * Time passing, as Stripe's own clock would see it: renewals that are due, retries that are
   * due, and cancellations that take effect. The jobs run this every 15 minutes.
   */
  advanceBilling(now = Date.now()): PaymentEvent[] {
    const events: PaymentEvent[] = [];
    this.write((store) => {
      for (const subscription of Object.values(store.subscriptions)) events.push(...advance(store, subscription, now));
    });
    return events;
  }

  /** Development: bill a membership's next period now, with a card that pays or declines. */
  renewNow(subscriptionId: string, outcome: "pay" | "decline"): PaymentEvent[] {
    const events: PaymentEvent[] = [];
    this.write((store) => {
      const subscription = store.subscriptions[subscriptionId];
      if (!subscription) throw new PaymentRefused("That subscription doesn't exist.");
      if (subscription.status === "canceled" || subscription.cancelAt) throw new PaymentRefused("This membership is cancelled.");
      if (subscription.status === "paused") throw new PaymentRefused("This membership is paused, so nothing is billed.");
      subscription.cardFails = outcome === "decline";
      const now = Date.now();
      subscription.periodEnd = new Date(now).toISOString();
      events.push(...advance(store, subscription, now));
    });
    return events;
  }

  /** Development: run a declined bill's next retry now instead of in a few days. */
  retryDueNow(subscriptionId: string): PaymentEvent[] {
    const events: PaymentEvent[] = [];
    this.write((store) => {
      const subscription = store.subscriptions[subscriptionId];
      if (!subscription) throw new PaymentRefused("That subscription doesn't exist.");
      const now = Date.now();
      const open = Object.values(store.invoices).filter((invoice) => invoice.subscriptionId === subscriptionId && invoice.status === "open");
      if (open.length === 0) throw new PaymentRefused("There's no unpaid bill to retry.");
      for (const invoice of open) invoice.nextAttemptAt = new Date(now).toISOString();
      events.push(...advance(store, subscription, now));
    });
    return events;
  }

  private completeSubscriptionCheckout(checkout: SimCheckout, outcome: "pay" | "decline"): { redirectUrl: string | null; events: PaymentEvent[] } {
    if (checkout.status === "complete") return { redirectUrl: checkout.successUrl, events: [] };
    if (checkout.status === "expired" || Date.parse(checkout.expiresAt) <= Date.now())
      throw new PaymentRefused("This checkout has expired. Go back and start again.");
    if (outcome === "decline") {
      this.write((store) => (store.checkouts[checkout.id]!.failure = "Your card was declined. Try another card."));
      return { redirectUrl: null, events: [] };
    }
    const events: PaymentEvent[] = [];
    this.write((store) => {
      const price = store.prices[checkout.priceId!]!;
      const now = new Date();
      const subscription: SimSubscription = {
        id: newId("sub"),
        accountId: checkout.accountId,
        customerId: newId("cus"),
        reference: checkout.reference,
        priceId: price.id,
        amountCents: price.amountCents,
        interval: price.interval,
        status: "active",
        periodStart: now.toISOString(),
        periodEnd: addInterval(now.toISOString(), price.interval),
        cancelAt: null,
        card: { ...TEST_CARD },
        cardFails: false,
        creditCents: 0,
        createdAt: now.toISOString(),
      };
      store.subscriptions[subscription.id] = subscription;
      const invoice = newInvoice(subscription, "cycle", price.amountCents, subscription.periodStart, subscription.periodEnd);
      store.invoices[invoice.id] = invoice;
      attempt(store, subscription, invoice, now.getTime());
      const target = store.checkouts[checkout.id]!;
      target.status = "complete";
      target.subscriptionId = subscription.id;
      target.failure = null;
      events.push(subscriptionEvent(subscription), invoiceEvent(invoice, subscription));
    });
    return { redirectUrl: checkout.successUrl, events };
  }

  private customerSubscription(store: Store, customerId: string) {
    return Object.values(store.subscriptions)
      .filter((subscription) => subscription.customerId === customerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  private subscription(store: Store, accountId: string, subscriptionId: string) {
    const subscription = store.subscriptions[subscriptionId];
    if (!subscription || subscription.accountId !== accountId) throw new PaymentRefused("That subscription doesn't exist.");
    return subscription;
  }

  private updateSubscription(accountId: string, subscriptionId: string, change: (subscription: SimSubscription) => void) {
    let state: SubscriptionState | null = null;
    this.write((store) => {
      const subscription = this.subscription(store, accountId, subscriptionId);
      change(subscription);
      state = subscriptionState(subscription);
    });
    return state!;
  }

  /* ── Internals ─────────────────────────────────────────────────────────── */

  private paymentEvent(checkoutId: string): PaymentEvent {
    const store = this.read();
    const checkout = store.checkouts[checkoutId]!;
    const state = stateOf(
      checkout,
      checkout.paymentId ? store.payments[checkout.paymentId] : undefined,
    );
    return { id: newId("evt"), type: "payment", accountId: checkout.accountId, state };
  }

  private updatePayment(
    accountId: string,
    paymentId: string,
    change: (payment: SimPayment) => void,
  ): PaymentState {
    const store = this.read();
    const payment = store.payments[paymentId];
    if (!payment || payment.accountId !== accountId)
      throw new PaymentRefused("That payment doesn't exist.");
    lapse(payment);
    this.write((draft) => {
      const target = draft.payments[paymentId]!;
      lapse(target);
      change(target);
    });
    const after = this.read();
    return stateOf(after.checkouts[payment.checkoutId]!, after.payments[paymentId]);
  }

  private checkoutUrl(id: string, origin = this.pageBase) {
    return `${origin}/sim/stripe/checkout/${id}`;
  }

  private account(store: Store, accountId: string) {
    const account = store.accounts[accountId];
    if (!account) throw new PaymentRefused("That payments account doesn't exist.");
    return account;
  }

  private read(): Store {
    if (this.cache) return this.cache;
    const saved = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as Partial<Store>) : {};
    // Files from before memberships have no billing objects yet.
    this.cache = {
      accounts: saved.accounts ?? {},
      checkouts: saved.checkouts ?? {},
      payments: saved.payments ?? {},
      products: saved.products ?? {},
      prices: saved.prices ?? {},
      subscriptions: saved.subscriptions ?? {},
      invoices: saved.invoices ?? {},
      portals: saved.portals ?? {},
    };
    // Earlier files marked a bill whose retries ran out "uncollectible"; it's an open bill.
    for (const invoice of Object.values(this.cache.invoices) as Array<{ status: string }>)
      if (invoice.status === "uncollectible") invoice.status = "open";
    return this.cache;
  }

  private write(change: (store: Store) => void) {
    const store = this.read();
    change(store);
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(store, null, 2));
    renameSync(temp, this.file);
  }
}

function accountState(account: SimAccount): AccountState {
  const active = account.status === "active";
  return {
    status: account.status,
    chargesEnabled: active,
    payoutsEnabled: active,
    requirements: active ? [] : SETUP_STEPS,
  };
}

/** Card networks drop a hold nobody collected; Stripe then reports the payment as canceled. */
function lapse(payment: SimPayment) {
  if (
    payment.status === "requires_capture" &&
    payment.holdExpiresAt &&
    Date.parse(payment.holdExpiresAt) <= Date.now()
  )
    payment.status = "canceled";
}

function stateOf(checkout: SimCheckout, payment: SimPayment | undefined): PaymentState {
  if (payment) lapse(payment);
  const expired =
    checkout.status === "expired" ||
    (checkout.status === "open" && Date.parse(checkout.expiresAt) <= Date.now());
  const status: PaymentState["status"] = !payment
    ? expired
      ? "expired"
      : "open"
    : payment.status === "requires_capture"
      ? "held"
      : payment.status === "succeeded"
        ? "paid"
        : "released";
  return {
    checkoutId: checkout.id,
    reference: checkout.reference,
    status,
    paymentId: payment?.id ?? null,
    amountCents: payment?.amountCents ?? checkout.amountCents,
    cardBrand: payment ? TEST_CARD.brand : null,
    cardLast4: payment ? TEST_CARD.last4 : null,
    holdExpiresAt: payment?.holdExpiresAt ? new Date(payment.holdExpiresAt) : null,
    failure: checkout.failure,
  };
}

/* ── Billing internals ───────────────────────────────────────────────────── */

function newInvoice(subscription: SimSubscription, kind: SimInvoice["kind"], amountCents: number, periodStart: string | null, periodEnd: string | null): SimInvoice {
  return {
    id: newId("in"),
    accountId: subscription.accountId,
    subscriptionId: subscription.id,
    kind,
    amountCents,
    status: "open",
    attempts: 0,
    nextAttemptAt: null,
    periodStart,
    periodEnd,
    paidAt: null,
    failure: null,
    createdAt: new Date().toISOString(),
  };
}

/** One charge attempt on a bill, and what it does to the subscription. */
function attempt(store: Store, subscription: SimSubscription, invoice: SimInvoice, now: number) {
  invoice.attempts += 1;
  if (subscription.cardFails && invoice.amountCents > 0) {
    invoice.failure = DECLINED;
    const wait = RETRY_DAYS[invoice.attempts - 1];
    invoice.status = "open";
    invoice.nextAttemptAt = wait === undefined ? null : new Date(now + wait * DAY_MS).toISOString();
    if (subscription.status === "active") subscription.status = "past_due";
    return;
  }
  invoice.status = "paid";
  invoice.paidAt = new Date(now).toISOString();
  invoice.failure = null;
  invoice.nextAttemptAt = null;
  const stillOwing = Object.values(store.invoices).some(
    (other) => other.subscriptionId === subscription.id && other.status === "open",
  );
  if (subscription.status === "past_due" && !stillOwing) subscription.status = "active";
}

/** Cancels at the end of the paid period (now, when the period isn't paid). Unpaid bills are voided. */
function cancel(store: Store, subscription: SimSubscription): SimInvoice[] {
  if (subscription.status === "canceled" || subscription.cancelAt) return [];
  const voided = Object.values(store.invoices).filter(
    (invoice) => invoice.subscriptionId === subscription.id && invoice.status === "open",
  );
  for (const invoice of voided) {
    invoice.status = "void";
    invoice.nextAttemptAt = null;
    invoice.failure = "Cancelled before it was paid.";
  }
  const paidUp = subscription.status === "active" || subscription.status === "paused";
  if (paidUp && Date.parse(subscription.periodEnd) > Date.now()) subscription.cancelAt = subscription.periodEnd;
  else {
    subscription.cancelAt = new Date().toISOString();
    subscription.status = "canceled";
  }
  return voided;
}

/** Brings one subscription up to `now`: cancellation, renewals, then due retries. */
function advance(store: Store, subscription: SimSubscription, now: number): PaymentEvent[] {
  const events: PaymentEvent[] = [];
  if (subscription.status === "canceled") return events;
  if (subscription.cancelAt && Date.parse(subscription.cancelAt) <= now) {
    subscription.status = "canceled";
    return [subscriptionEvent(subscription)];
  }
  for (let guard = 0; guard < 24 && Date.parse(subscription.periodEnd) <= now; guard++) {
    const start = subscription.periodEnd;
    const end = addInterval(start, subscription.interval);
    subscription.periodStart = start;
    subscription.periodEnd = end;
    // Paused: the period rolls on with nothing billed.
    if (subscription.status === "paused") continue;
    const credit = Math.min(subscription.creditCents, subscription.amountCents);
    subscription.creditCents -= credit;
    const invoice = newInvoice(subscription, "cycle", subscription.amountCents - credit, start, end);
    store.invoices[invoice.id] = invoice;
    attempt(store, subscription, invoice, now);
    events.push(invoiceEvent(invoice, subscription));
  }
  for (const invoice of Object.values(store.invoices)) {
    if (invoice.subscriptionId !== subscription.id || invoice.status !== "open" || !invoice.nextAttemptAt) continue;
    if (Date.parse(invoice.nextAttemptAt) > now) continue;
    attempt(store, subscription, invoice, now);
    events.push(invoiceEvent(invoice, subscription));
  }
  if (events.length > 0) events.unshift(subscriptionEvent(subscription));
  return events;
}

function subscriptionState(subscription: SimSubscription): SubscriptionState {
  return {
    subscriptionId: subscription.id,
    customerId: subscription.customerId,
    reference: subscription.reference,
    priceId: subscription.priceId,
    amountCents: subscription.amountCents,
    interval: subscription.interval,
    status: subscription.status,
    currentPeriodEnd: subscription.status === "canceled" ? null : new Date(subscription.periodEnd),
    endsAt: subscription.cancelAt ? new Date(subscription.cancelAt) : null,
    cardBrand: subscription.card.brand,
    cardLast4: subscription.card.last4,
  };
}

function invoiceState(invoice: SimInvoice, subscription: SimSubscription): InvoiceState {
  return {
    invoiceId: invoice.id,
    subscriptionId: subscription.id,
    reference: subscription.reference,
    kind: invoice.kind,
    amountCents: invoice.amountCents,
    // Open with no retry left: every try failed.
    status: invoice.status === "paid" ? "paid" : invoice.status === "open" && invoice.nextAttemptAt ? "retrying" : "failed",
    attempts: invoice.attempts,
    nextAttemptAt: invoice.nextAttemptAt ? new Date(invoice.nextAttemptAt) : null,
    periodStart: invoice.periodStart ? new Date(invoice.periodStart) : null,
    periodEnd: invoice.periodEnd ? new Date(invoice.periodEnd) : null,
    paidAt: invoice.paidAt ? new Date(invoice.paidAt) : null,
    failure: invoice.failure,
  };
}

const subscriptionEvent = (subscription: SimSubscription): PaymentEvent => ({
  id: newId("evt"),
  type: "subscription",
  accountId: subscription.accountId,
  subscription: subscriptionState(subscription),
});

const invoiceEvent = (invoice: SimInvoice, subscription: SimSubscription): PaymentEvent => ({
  id: newId("evt"),
  type: "invoice",
  accountId: subscription.accountId,
  invoice: invoiceState(invoice, subscription),
});
