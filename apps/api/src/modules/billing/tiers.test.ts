import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FEATURES, accessTier, tierAllows, trialDaysLeft } from "@leadanchor/contracts";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { SimulatorBilling } from "../../integrations/billing/simulator";
import { tierSubscriptionOf } from "../../integrations/billing/stripe";

const now = new Date("2026-11-03T12:00:00Z");
const days = (count: number) => new Date(now.getTime() + count * 86_400_000);

describe("what a business can use (the tier key)", () => {
  it("opens everything on a trial, and nothing extra once it ends", () => {
    expect(accessTier({ status: "trial", tier: null, trialEndsAt: days(5) }, now)).toBe("growth");
    expect(accessTier({ status: "trial", tier: null, trialEndsAt: days(-1) }, now)).toBeNull();
    expect(accessTier({ status: "trial", tier: null, trialEndsAt: null }, now)).toBeNull();
  });

  it("gives a paying business its own tier, also while a card retry is pending", () => {
    expect(accessTier({ status: "active", tier: "starter", trialEndsAt: days(5) }, now)).toBe("starter");
    expect(accessTier({ status: "past_due", tier: "pro", trialEndsAt: null }, now)).toBe("pro");
    expect(accessTier({ status: "cancelled", tier: "pro", trialEndsAt: null }, now)).toBeNull();
    expect(accessTier({ status: "suspended", tier: "growth", trialEndsAt: null }, now)).toBeNull();
  });

  it("keeps the demo business on everything", () => {
    expect(accessTier({ status: "trial", tier: null, trialEndsAt: days(-30), isDemo: true }, now)).toBe("growth");
  });

  it("matches the Excel: Pro features on Pro and Growth, memberships on Growth only", () => {
    expect(tierAllows("starter", "campaigns")).toBe(false);
    expect(tierAllows("pro", "campaigns")).toBe(true);
    expect(tierAllows("pro", "memberships")).toBe(false);
    expect(tierAllows("growth", "memberships")).toBe(true);
    expect(FEATURES.every((feature) => tierAllows("growth", feature))).toBe(true);
    expect(FEATURES.some((feature) => tierAllows(null, feature))).toBe(false);
  });

  it("counts trial days up, so the last day still reads 1", () => {
    expect(trialDaysLeft(new Date(now.getTime() + 3_600_000), now)).toBe(1);
    expect(trialDaysLeft(days(14), now)).toBe(14);
    expect(trialDaysLeft(days(-2), now)).toBe(0);
  });
});

describe("reading LeadAnchor's own Stripe subscription", () => {
  const subscription = (fields: Partial<Stripe.Subscription>) =>
    ({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      metadata: { tenantId: "t1", tier: "pro" },
      items: { data: [{ current_period_end: 1_795_000_000, price: { metadata: {} } }] },
      cancel_at: null,
      cancel_at_period_end: false,
      ...fields,
    }) as unknown as Stripe.Subscription;

  it("finds the business and tier, and counts a paid-for trial as active", () => {
    const state = tierSubscriptionOf(subscription({ status: "trialing" }));
    expect(state).toMatchObject({ tenantId: "t1", tier: "pro", status: "active", cancelsAt: null });
    expect(state.periodEnd?.toISOString()).toBe(new Date(1_795_000_000 * 1000).toISOString());
  });

  it("reads past due, cancelled and a cancellation at the period's end", () => {
    expect(tierSubscriptionOf(subscription({ status: "past_due" })).status).toBe("past_due");
    expect(tierSubscriptionOf(subscription({ status: "canceled" }))).toMatchObject({ status: "canceled", periodEnd: null });
    const leaving = tierSubscriptionOf(subscription({ cancel_at_period_end: true }));
    expect(leaving.cancelsAt?.getTime()).toBe(1_795_000_000 * 1000);
  });
});

describe("the billing simulator", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
  const simulator = () => {
    dir = mkdtempSync(join(tmpdir(), "la-billing-"));
    return new SimulatorBilling(join(dir, "billing.json"));
  };
  const checkoutFor = (sim: SimulatorBilling, trialEndsAt: Date | null) =>
    sim.checkout({
      tenantId: "t1",
      tier: "pro",
      customerId: null,
      email: "owner@example.com",
      businessName: "Rivera Plumbing",
      successUrl: "http://localhost:3000/settings?billing=back&checkout={CHECKOUT_SESSION_ID}#plan",
      cancelUrl: "http://localhost:3000/settings#plan",
      trialEndsAt,
    });

  it("starts a subscription from a paid checkout, charging first when the trial ends", async () => {
    const sim = simulator();
    const trialEnd = new Date(Date.now() + 10 * 86_400_000);
    const { url, checkoutId } = await checkoutFor(sim, trialEnd);
    expect(url).toBe(`http://localhost:3000/sim/billing/checkout/${checkoutId}`);
    expect(await sim.subscriptionForCheckout(checkoutId)).toBeNull();
    expect(sim.checkoutView(checkoutId).firstChargeAt).toBe(trialEnd.toISOString());

    const { redirect, subscription } = sim.completeCheckout(checkoutId, false);
    expect(redirect).toContain(`checkout=${checkoutId}`);
    expect(subscription).toMatchObject({ tenantId: "t1", tier: "pro", status: "active" });
    expect(subscription.periodEnd?.toISOString()).toBe(trialEnd.toISOString());
    expect(await sim.subscriptionForCheckout(checkoutId)).toMatchObject({ subscriptionId: subscription.subscriptionId });
  });

  it("refuses a declined card, and lets a plan change, cancel, fail and renew", async () => {
    const sim = simulator();
    const { checkoutId } = await checkoutFor(sim, null);
    expect(() => sim.completeCheckout(checkoutId, true)).toThrow(/declined/);
    const { subscription } = sim.completeCheckout(checkoutId, false);

    expect((await sim.changeTier(subscription.subscriptionId, "growth")).tier).toBe("growth");
    const portalUrl = await sim.portalUrl(subscription.customerId, "http://localhost:3000/settings?billing=back#plan");
    const portalId = portalUrl.split("/").at(-1)!;
    expect(sim.portalAction(portalId, "cancel")?.cancelsAt).not.toBeNull();
    expect(sim.portalAction(portalId, "resume")?.cancelsAt).toBeNull();
    sim.portalAction(portalId, "fail_next");
    expect(sim.portalAction(portalId, "renew")?.status).toBe("past_due");
    expect(sim.portalAction(portalId, "renew")?.status).toBe("active");
  });

  it("sells the website add-on on its own subscription: setup today, hosting monthly, stop any time (C-33)", async () => {
    const sim = simulator();
    const { url, checkoutId } = await sim.addonCheckout({
      tenantId: "t1",
      customerId: null,
      email: "owner@example.com",
      businessName: "Rivera Plumbing",
      successUrl: "http://localhost:3000/settings?billing=back&checkout={CHECKOUT_SESSION_ID}#website",
      cancelUrl: "http://localhost:3000/settings#website",
    });
    expect(url).toBe(`http://localhost:3000/sim/billing/checkout/${checkoutId}`);
    expect(sim.checkoutView(checkoutId)).toMatchObject({ product: "website", tier: null, priceCents: 500, setupCents: 14_900 });
    expect(() => sim.completeCheckout(checkoutId, false)).toThrow();

    const { redirect, addon } = sim.completeAddonCheckout(checkoutId, false);
    expect(redirect).toContain(`checkout=${checkoutId}`);
    expect(addon).toMatchObject({ tenantId: "t1", status: "active", cancelsAt: null });
    expect(await sim.addonForCheckout(checkoutId)).toMatchObject({ subscriptionId: addon.subscriptionId });
    expect(await sim.subscriptionForCheckout(checkoutId)).toBeNull();
    expect((await sim.setAddonCancel(addon.subscriptionId, true)).cancelsAt).not.toBeNull();
    expect((await sim.setAddonCancel(addon.subscriptionId, false)).cancelsAt).toBeNull();
  });

  it("takes credit off the next renewal, and counts a retried credit once", async () => {
    const sim = simulator();
    const { checkoutId } = await checkoutFor(sim, null);
    const { subscription } = sim.completeCheckout(checkoutId, false);
    await sim.addCredit(subscription.customerId, 10_500, "Referral", "credit:1");
    await sim.addCredit(subscription.customerId, 10_500, "Referral", "credit:1");
    await sim.addCredit(subscription.customerId, 3_500, "Referral", "credit:2");
    expect(await sim.creditCents(subscription.customerId)).toBe(14_000);
    const portalId = (await sim.portalUrl(subscription.customerId, "http://localhost:3000/settings")).split("/").at(-1)!;
    sim.portalAction(portalId, "renew");
    expect(await sim.creditCents(subscription.customerId)).toBe(3_500);
  });
});
