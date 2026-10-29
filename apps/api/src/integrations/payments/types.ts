import type { PaymentCapture, PaymentProviderName } from "@leadanchor/contracts";

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

export type PaymentEvent =
  | { id: string; type: "payment"; accountId: string; state: PaymentState }
  | { id: string; type: "account"; accountId: string; account: AccountState };

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
}

/** The provider refused an action, with a message fit for the owner. */
export class PaymentRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentRefused";
  }
}
