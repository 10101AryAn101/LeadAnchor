import type { PaymentCapture, PaymentProviderName, PlanInterval } from "@leadanchor/contracts";

/**
 * Payments port (module 7). Shaped after Stripe Connect + Checkout: each business has its own
 * connected account, customers pay on the provider's hosted page, and card details never
 * reach LeadAnchor. A deposit is a card hold that is collected (captured) or released later.
 */

export interface AccountState {
  status: "onboarding" | "active" | "restricted";
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  /** What the provider still needs from the owner, in plain words. */
  requirements: string[];
}

export interface CheckoutInput {
  accountId: string;
  amountCents: number;
  /** The line the customer sees on the hosted page, e.g. "Deposit: Drain cleaning". */
  description: string;
  businessName: string;
  capture: PaymentCapture;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
  /** Our payment request id; it comes back on every event about this checkout. */
  reference: string;
  idempotencyKey: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
  expiresAt: Date;
}

/**
 * Where one checkout stands, as the provider sees it. Webhooks and the reconciliation job
 * both reduce to this, so they update our records the same way.
 * open: not paid yet; held: card authorised, not collected; paid: money collected;
 * released: the hold was dropped; expired: the checkout closed unpaid.
 */
export interface PaymentState {
  checkoutId: string;
  reference: string;
  status: "open" | "held" | "paid" | "released" | "expired";
  paymentId: string | null;
  amountCents: number;
  cardBrand: string | null;
  cardLast4: string | null;
  holdExpiresAt: Date | null;
  /** The latest decline message, e.g. "Your card was declined." */
  failure: string | null;
}

/* ── Billing (memberships, module 12): Stripe Products, Prices, Subscriptions, Invoices ── */

export interface PriceInput {
  accountId: string;
  /** The plan's Product; null makes one. */
  productId: string | null;
  name: string;
  description: string;
  amountCents: number;
  interval: PlanInterval;
  idempotencyKey: string;
}

export interface SubscriptionCheckoutInput {
  accountId: string;
  priceId: string;
  businessName: string;
  planName: string;
  /** Shown in full on the hosted page before they pay (ROSCA, C-49 AC 1). */
  terms: string[];
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /** Our membership id; it comes back on every event about this subscription. */
  reference: string;
  idempotencyKey: string;
}

/**
 * Where a subscription stands, as the provider sees it. Cancelling keeps it running to the end
 * of the paid period: `endsAt` is set, then it turns "canceled".
 */
export interface SubscriptionState {
  subscriptionId: string;
  customerId: string;
  reference: string;
  priceId: string;
  amountCents: number;
  interval: PlanInterval;
  status: "active" | "past_due" | "paused" | "canceled";
  currentPeriodEnd: Date | null;
  endsAt: Date | null;
  cardBrand: string | null;
  cardLast4: string | null;
}

/**
 * One bill. retrying: declined, with another try on the provider's schedule; failed: every
 * try failed (or it was voided by a cancellation). Prorations come from the provider.
 */
export interface InvoiceState {
  invoiceId: string;
  subscriptionId: string;
  reference: string;
  kind: "cycle" | "proration";
  amountCents: number;
  status: "paid" | "retrying" | "failed";
  attempts: number;
  nextAttemptAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  paidAt: Date | null;
  failure: string | null;
}

export type PaymentEvent =
  | { id: string; type: "payment"; accountId: string; state: PaymentState }
  | { id: string; type: "account"; accountId: string; account: AccountState }
  | { id: string; type: "subscription"; accountId: string; subscription: SubscriptionState }
  | { id: string; type: "invoice"; accountId: string; invoice: InvoiceState };

export interface PaymentsProvider {
  readonly name: PaymentProviderName;
  createAccount(input: {
    tenantId: string;
    businessName: string;
    email: string | null;
  }): Promise<{ accountId: string }>;
  /** A one-time link to the provider's hosted setup (bank account, identity). */
  onboardingUrl(
    accountId: string,
    urls: { returnUrl: string; refreshUrl: string },
  ): Promise<string>;
  getAccount(accountId: string): Promise<AccountState>;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  getPayment(accountId: string, checkoutId: string): Promise<PaymentState>;
  /** Collects a held card payment. */
  capture(accountId: string, paymentId: string): Promise<PaymentState>;
  /** Drops a hold without charging the card. */
  release(accountId: string, paymentId: string): Promise<PaymentState>;
  /** Closes an unpaid checkout so its page stops taking payments. */
  expireCheckout(accountId: string, checkoutId: string): Promise<void>;

  /* Billing (memberships) */
  /** A Price for a plan (and its Product the first time). Prices never change: a new price is a new Price. */
  createPrice(input: PriceInput): Promise<{ productId: string; priceId: string }>;
  /** The provider's hosted page that stores the card and starts the subscription. */
  createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<CheckoutSession>;
  /** The subscription a finished checkout started, or null while it's still open. */
  subscriptionForCheckout(accountId: string, checkoutId: string): Promise<SubscriptionState | null>;
  getSubscription(accountId: string, subscriptionId: string): Promise<SubscriptionState>;
  /** Stops collecting until resumed; nothing is charged while paused. */
  pauseSubscription(accountId: string, subscriptionId: string): Promise<SubscriptionState>;
  resumeSubscription(accountId: string, subscriptionId: string): Promise<SubscriptionState>;
  /** Cancels at the end of the paid period; nothing more is charged. */
  cancelSubscription(accountId: string, subscriptionId: string): Promise<SubscriptionState>;
  /** Moves to another Price now; the provider works out and bills (or credits) the difference. */
  changeSubscriptionPrice(
    accountId: string,
    subscriptionId: string,
    priceId: string,
  ): Promise<{ subscription: SubscriptionState; invoice: InvoiceState | null }>;
  /** Tries a declined bill again now. */
  retryInvoice(accountId: string, invoiceId: string): Promise<InvoiceState>;
  /** The provider's hosted page where a member updates their card, sees bills, or cancels. */
  portalUrl(accountId: string, customerId: string, returnUrl: string): Promise<string>;
}

/** The provider refused an action, with a message fit for the owner. */
export class PaymentRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentRefused";
  }
}
