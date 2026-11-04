import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type SimTierCheckout, type SimTierPortal, type SimTierPortalAction, TIER_DETAILS, type Tier, WEBSITE_ADDON } from "@leadanchor/contracts";
import { PaymentRefused } from "../payments/types";
import {
  type AddonCheckoutInput,
  type AddonSubscription,
  type BillingProvider,
  MIN_TRIAL_LEFT_MS,
  type TierCheckoutInput,
  type TierSubscription,
} from "./types";

interface SimCustomer {
  id: string;
  email: string;
  tenantId: string;
  creditCents: number;
  /** Keys of credits already added, so a retried credit isn't counted twice. */
  creditKeys: string[];
}

interface SimCheckoutRecord extends Omit<TierCheckoutInput, "tier"> {
  id: string;
  status: "open" | "complete";
  subscriptionId: string | null;
  /** A tier, or the website add-on (C-33). Older saved checkouts have no product: they're tiers. */
  product?: "tier" | "website";
  tier: Tier | null;
}

/** C-33: the website add-on's hosting subscription. */
interface SimAddon {
  id: string;
  customerId: string;
  tenantId: string;
  status: AddonSubscription["status"];
  periodEnd: string;
  cancelAtPeriodEnd: boolean;
}

interface SimTierSubscription {
  id: string;
  customerId: string;
  tenantId: string;
  tier: Tier;
  status: TierSubscription["status"];
  periodEnd: string;
  cancelAtPeriodEnd: boolean;
  /** The next charge fails, to try past-due handling. */
  failNext: boolean;
}

interface Store {
  customers: Record<string, SimCustomer>;
  checkouts: Record<string, SimCheckoutRecord>;
  subscriptions: Record<string, SimTierSubscription>;
  addons: Record<string, SimAddon>;
  portals: Record<string, { id: string; customerId: string; returnUrl: string }>;
}

const MONTH_MS = 30 * 86_400_000;
const newId = (prefix: string) => `${prefix}_sim_${randomBytes(9).toString("hex")}`;

/**
 * LeadAnchor's own billing without Stripe: checkouts, subscriptions, credit and a billing page,
 * hosted under /sim/billing on the web app. State is kept in a file, so plans survive restarts.
 */
export class SimulatorBilling implements BillingProvider {
  readonly name = "simulator" as const;
  private cache: Store | null = null;

  constructor(private readonly file: string) {}

  async checkout(input: TierCheckoutInput) {
    const checkout: SimCheckoutRecord = { ...input, id: newId("cs"), status: "open", subscriptionId: null };
    this.write((store) => (store.checkouts[checkout.id] = checkout));
    // The owner's own web address, so the round trip keeps them signed in.
    return { url: `${new URL(input.cancelUrl).origin}/sim/billing/checkout/${checkout.id}`, checkoutId: checkout.id };
  }

  async subscriptionForCheckout(checkoutId: string) {
    const store = this.read();
    const checkout = store.checkouts[checkoutId];
    const subscription = checkout?.subscriptionId ? store.subscriptions[checkout.subscriptionId] : undefined;
    return subscription ? stateOf(subscription) : null;
  }

  async getSubscription(subscriptionId: string) {
    return stateOf(this.subscription(this.read(), subscriptionId));
  }

  async changeTier(subscriptionId: string, tier: Tier) {
    let changed!: SimTierSubscription;
    this.write((store) => {
      changed = this.subscription(store, subscriptionId);
      if (changed.status === "canceled") throw new PaymentRefused("That subscription has ended. Choose a plan to start a new one.");
      changed.tier = tier;
      // Picking a tier again means keeping it, so a pending cancellation is undone.
      changed.cancelAtPeriodEnd = false;
    });
    return stateOf(changed);
  }

  async portalUrl(customerId: string, returnUrl: string) {
    const portal = { id: newId("bps"), customerId, returnUrl };
    this.write((store) => {
      this.customer(store, customerId);
      store.portals[portal.id] = portal;
    });
    return `${new URL(returnUrl).origin}/sim/billing/portal/${portal.id}`;
  }

  async addCredit(customerId: string, cents: number, _reason: string, key: string) {
    this.write((store) => {
      const customer = this.customer(store, customerId);
      if (customer.creditKeys.includes(key)) return;
      customer.creditKeys.push(key);
      customer.creditCents += cents;
    });
  }

  async creditCents(customerId: string) {
    return this.read().customers[customerId]?.creditCents ?? 0;
  }

  async addonCheckout(input: AddonCheckoutInput) {
    const checkout: SimCheckoutRecord = {
      ...input,
      id: newId("cs"),
      status: "open",
      subscriptionId: null,
      product: "website",
      tier: null,
      trialEndsAt: null,
    };
    this.write((store) => (store.checkouts[checkout.id] = checkout));
    return { url: `${new URL(input.cancelUrl).origin}/sim/billing/checkout/${checkout.id}`, checkoutId: checkout.id };
  }

  async addonForCheckout(checkoutId: string) {
    const store = this.read();
    const checkout = store.checkouts[checkoutId];
    const addon = checkout?.product === "website" && checkout.subscriptionId ? store.addons[checkout.subscriptionId] : undefined;
    return addon ? addonStateOf(addon) : null;
  }

  async getAddon(subscriptionId: string) {
    const addon = this.read().addons[subscriptionId];
    if (!addon) throw new PaymentRefused("That website subscription doesn't exist.");
    return addonStateOf(addon);
  }

  async setAddonCancel(subscriptionId: string, cancel: boolean) {
    let changed!: SimAddon;
    this.write((store) => {
      const addon = store.addons[subscriptionId];
      if (!addon) throw new PaymentRefused("That website subscription doesn't exist.");
      if (addon.status === "canceled") throw new PaymentRefused("The website has ended. Add it again to start a new one.");
      addon.cancelAtPeriodEnd = cancel;
      changed = addon;
    });
    return addonStateOf(changed);
  }

  /* ── The simulated pages (development only) ─────────────────────────────── */

  checkoutView(checkoutId: string): SimTierCheckout {
    const checkout = this.read().checkouts[checkoutId];
    if (!checkout) throw new PaymentRefused("That checkout doesn't exist any more.");
    if (checkout.product === "website" || !checkout.tier) {
      return {
        id: checkout.id,
        businessName: checkout.businessName,
        product: "website",
        tier: null,
        tierName: WEBSITE_ADDON.name,
        priceCents: WEBSITE_ADDON.monthlyCents,
        setupCents: WEBSITE_ADDON.setupCents,
        firstChargeAt: null,
        status: checkout.status,
        cancelUrl: checkout.cancelUrl,
      };
    }
    const trialEnd = checkout.trialEndsAt ? new Date(checkout.trialEndsAt) : null;
    return {
      id: checkout.id,
      businessName: checkout.businessName,
      product: "tier",
      tier: checkout.tier,
      tierName: TIER_DETAILS[checkout.tier].name,
      priceCents: TIER_DETAILS[checkout.tier].priceCents,
      setupCents: null,
      firstChargeAt: trialEnd && trialEnd.getTime() - Date.now() >= MIN_TRIAL_LEFT_MS ? trialEnd.toISOString() : null,
      status: checkout.status,
      cancelUrl: checkout.cancelUrl,
    };
  }

  /** "Pay" on the simulated checkout for the website add-on (C-33): setup today, then hosting monthly. */
  completeAddonCheckout(checkoutId: string, decline: boolean): { redirect: string; addon: AddonSubscription } {
    if (decline) throw new PaymentRefused("Your card was declined. Try another card.");
    let result!: { redirect: string; addon: AddonSubscription };
    this.write((store) => {
      const checkout = store.checkouts[checkoutId];
      if (!checkout || checkout.product !== "website") throw new PaymentRefused("That checkout doesn't exist any more.");
      if (!checkout.subscriptionId) {
        const customer = this.customerFor(store, checkout);
        const addon: SimAddon = {
          id: newId("sub"),
          customerId: customer.id,
          tenantId: checkout.tenantId,
          status: "active",
          periodEnd: new Date(Date.now() + MONTH_MS).toISOString(),
          cancelAtPeriodEnd: false,
        };
        store.addons[addon.id] = addon;
        checkout.subscriptionId = addon.id;
        checkout.status = "complete";
      }
      result = {
        redirect: checkout.successUrl.replace("{CHECKOUT_SESSION_ID}", checkout.id),
        addon: addonStateOf(store.addons[checkout.subscriptionId]!),
      };
    });
    return result;
  }

  /** The checkout's billing customer: the one it names, the business's existing one, or a new one. */
  private customerFor(store: Store, checkout: SimCheckoutRecord) {
    let customer =
      (checkout.customerId ? store.customers[checkout.customerId] : undefined) ??
      Object.values(store.customers).find((item) => item.tenantId === checkout.tenantId);
    if (!customer) {
      customer = { id: newId("cus"), email: checkout.email, tenantId: checkout.tenantId, creditCents: 0, creditKeys: [] };
      store.customers[customer.id] = customer;
    }
    checkout.customerId = customer.id;
    return customer;
  }

  /** "Subscribe" on the simulated checkout: the card is always accepted, unless asked to decline. */
  completeCheckout(checkoutId: string, decline: boolean): { redirect: string; subscription: TierSubscription } {
    if (decline) throw new PaymentRefused("Your card was declined. Try another card.");
    let result!: { redirect: string; subscription: TierSubscription };
    this.write((store) => {
      const checkout = store.checkouts[checkoutId];
      if (!checkout || !checkout.tier) throw new PaymentRefused("That checkout doesn't exist any more.");
      const existing = checkout.subscriptionId ? store.subscriptions[checkout.subscriptionId] : undefined;
      if (!existing) {
        const customer = this.customerFor(store, checkout);
        const trialEnd = checkout.trialEndsAt ? new Date(checkout.trialEndsAt).getTime() : 0;
        const subscription: SimTierSubscription = {
          id: newId("sub"),
          customerId: customer.id,
          tenantId: checkout.tenantId,
          tier: checkout.tier,
          status: "active",
          periodEnd: new Date(trialEnd - Date.now() >= MIN_TRIAL_LEFT_MS ? trialEnd : Date.now() + MONTH_MS).toISOString(),
          cancelAtPeriodEnd: false,
          failNext: false,
        };
        store.subscriptions[subscription.id] = subscription;
        checkout.subscriptionId = subscription.id;
        checkout.status = "complete";
      }
      const subscription = store.subscriptions[checkout.subscriptionId!]!;
      result = { redirect: checkout.successUrl.replace("{CHECKOUT_SESSION_ID}", checkout.id), subscription: stateOf(subscription) };
    });
    return result;
  }

  portalView(portalId: string): SimTierPortal {
    const store = this.read();
    const portal = store.portals[portalId];
    if (!portal) throw new PaymentRefused("That billing page has expired. Open it again from Settings.");
    const customer = this.customer(store, portal.customerId);
    const subscription = Object.values(store.subscriptions)
      .filter((item) => item.customerId === customer.id)
      .sort((a, b) => Number(a.status === "canceled") - Number(b.status === "canceled"))[0];
    return {
      id: portal.id,
      email: customer.email,
      returnUrl: portal.returnUrl,
      creditCents: customer.creditCents,
      subscription: subscription
        ? {
            tier: subscription.tier,
            tierName: TIER_DETAILS[subscription.tier].name,
            priceCents: TIER_DETAILS[subscription.tier].priceCents,
            status: subscription.status,
            periodEnd: subscription.periodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          }
        : null,
    };
  }

  /** A button on the simulated billing page; returns the subscription so the app can catch up. */
  portalAction(portalId: string, action: SimTierPortalAction): TierSubscription | null {
    let changed: SimTierSubscription | null = null;
    this.write((store) => {
      const portal = store.portals[portalId];
      if (!portal) throw new PaymentRefused("That billing page has expired. Open it again from Settings.");
      const subscription = Object.values(store.subscriptions).find(
        (item) => item.customerId === portal.customerId && item.status !== "canceled",
      );
      if (!subscription) throw new PaymentRefused("There's no plan to change here.");
      if (action === "cancel") subscription.cancelAtPeriodEnd = true;
      if (action === "resume") subscription.cancelAtPeriodEnd = false;
      if (action === "fail_next") subscription.failNext = true;
      if (action === "renew") this.renew(store, subscription);
      changed = subscription;
    });
    return changed ? stateOf(changed) : null;
  }

  /** The billing clock: a renewal that is paid, declined, or ends a cancelled plan. */
  private renew(store: Store, subscription: SimTierSubscription) {
    if (subscription.cancelAtPeriodEnd) {
      subscription.status = "canceled";
      return;
    }
    const customer = this.customer(store, subscription.customerId);
    if (subscription.failNext) {
      subscription.failNext = false;
      subscription.status = "past_due";
      return;
    }
    // Credit goes first, then the card covers the rest.
    customer.creditCents = Math.max(0, customer.creditCents - TIER_DETAILS[subscription.tier].priceCents);
    subscription.status = "active";
    subscription.periodEnd = new Date(Math.max(Date.now(), new Date(subscription.periodEnd).getTime()) + MONTH_MS).toISOString();
  }

  private subscription(store: Store, subscriptionId: string) {
    const subscription = store.subscriptions[subscriptionId];
    if (!subscription) throw new PaymentRefused("That subscription doesn't exist.");
    return subscription;
  }

  private customer(store: Store, customerId: string) {
    const customer = store.customers[customerId];
    if (!customer) throw new PaymentRefused("That billing customer doesn't exist.");
    return customer;
  }

  private read(): Store {
    if (this.cache) return this.cache;
    const saved = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as Partial<Store>) : {};
    this.cache = {
      customers: saved.customers ?? {},
      checkouts: saved.checkouts ?? {},
      subscriptions: saved.subscriptions ?? {},
      addons: saved.addons ?? {},
      portals: saved.portals ?? {},
    };
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

function addonStateOf(addon: SimAddon): AddonSubscription {
  return {
    subscriptionId: addon.id,
    customerId: addon.customerId,
    tenantId: addon.tenantId,
    status: addon.status,
    cancelsAt: addon.cancelAtPeriodEnd ? new Date(addon.periodEnd) : null,
  };
}

function stateOf(subscription: SimTierSubscription): TierSubscription {
  const periodEnd = new Date(subscription.periodEnd);
  return {
    subscriptionId: subscription.id,
    customerId: subscription.customerId,
    tenantId: subscription.tenantId,
    tier: subscription.tier,
    status: subscription.status,
    periodEnd: subscription.status === "canceled" ? null : periodEnd,
    cancelsAt: subscription.cancelAtPeriodEnd ? periodEnd : null,
  };
}
