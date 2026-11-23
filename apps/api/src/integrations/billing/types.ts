import type { Tier } from "@leadanchor/contracts";

/** C-33: the website add-on, on its own subscription (hosting each month, the setup fee on the first bill). */
export interface AddonSubscription {
  subscriptionId: string;
  customerId: string;
  tenantId: string;
  status: "active" | "past_due" | "canceled" | "incomplete";
  /** Set once hosting is stopped: the end of the paid month. */
  cancelsAt: Date | null;
}

export interface AddonCheckoutInput {
  tenantId: string;
  customerId: string | null;
  email: string;
  businessName: string;
  successUrl: string;
  cancelUrl: string;
}

/** A business's LeadAnchor subscription, as the billing provider reports it. */
export interface TierSubscription {
  subscriptionId: string;
  customerId: string;
  /** Carried in the subscription's metadata, so an event finds its business without a lookup. */
  tenantId: string;
  tier: Tier;
  /** Active covers a paid-for trial too: the first charge waits for the trial's end. */
  status: "active" | "past_due" | "canceled" | "incomplete";
  periodEnd: Date | null;
  /** When a cancellation takes effect (the end of the paid period). */
  cancelsAt: Date | null;
}

export interface TierCheckoutInput {
  tenantId: string;
  tier: Tier;
  customerId: string | null;
  email: string;
  businessName: string;
  /** Carries {CHECKOUT_SESSION_ID}, which the provider fills in. */
  successUrl: string;
  cancelUrl: string;
  /** No charge before this, when the business still has trial days left. */
  trialEndsAt: Date | null;
}

/**
 * LeadAnchor's own billing: businesses paying for their tier. It runs on LeadAnchor's account,
 * separate from the payments provider, which works inside each business's own account.
 */
export interface BillingProvider {
  readonly name: "stripe" | "simulator";
  checkout(input: TierCheckoutInput): Promise<{ url: string; checkoutId: string }>;
  /** The subscription a finished checkout started; null while it isn't finished. */
  subscriptionForCheckout(checkoutId: string): Promise<TierSubscription | null>;
  getSubscription(subscriptionId: string): Promise<TierSubscription>;
  /** Moves to another tier now; the provider settles the difference and renames the plan on its bills. */
  changeTier(subscriptionId: string, tier: Tier, businessName: string): Promise<TierSubscription>;
  /** The provider's own page for the card, past bills and cancelling. */
  portalUrl(customerId: string, returnUrl: string): Promise<string>;
  /** Credit that comes off the next bills (C-25). `key` makes a retry harmless. */
  addCredit(customerId: string, cents: number, reason: string, key: string): Promise<void>;
  creditCents(customerId: string): Promise<number>;
  /** C-33: checkout for the website add-on. */
  addonCheckout(input: AddonCheckoutInput): Promise<{ url: string; checkoutId: string }>;
  addonForCheckout(checkoutId: string): Promise<AddonSubscription | null>;
  getAddon(subscriptionId: string): Promise<AddonSubscription>;
  /** Stops the hosting at the end of the paid month, or keeps it after all. */
  setAddonCancel(subscriptionId: string, cancel: boolean): Promise<AddonSubscription>;
}

export { MIN_TRIAL_LEFT_MS } from "@leadanchor/contracts";
