import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RETRY_DAYS, SimulatorPayments } from "./simulator";
import type { InvoiceState, PaymentEvent, SubscriptionState } from "./types";

let dir: string;
let sim: SimulatorPayments;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "la-billing-"));
  sim = new SimulatorPayments(join(dir, "payments.json"), "http://localhost:3000");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const DAY = 86_400_000;
const invoices = (events: PaymentEvent[]) =>
  events.flatMap((event) => (event.type === "invoice" ? [event.invoice] : [])) as InvoiceState[];
const subscriptions = (events: PaymentEvent[]) =>
  events.flatMap((event) =>
    event.type === "subscription" ? [event.subscription] : [],
  ) as SubscriptionState[];

/** A business with card payments on, a $99 monthly plan, and one member who just joined. */
async function member(amountCents = 9_900) {
  const { accountId } = await sim.createAccount({ businessName: "Demo Plumbing" });
  await sim.onboardingUrl(accountId, { returnUrl: "http://localhost:3000/settings" });
  sim.completeOnboarding(accountId, "finish");
  const { productId, priceId } = await sim.createPrice({
    accountId,
    productId: null,
    name: "Gold AC Care",
    description: "",
    amountCents,
    interval: "month",
    idempotencyKey: `price-${amountCents}`,
  });
  const session = await sim.createSubscriptionCheckout({
    accountId,
    priceId,
    businessName: "Demo Plumbing",
    planName: "Gold AC Care",
    terms: ["You pay $99 today, then $99 every month until you cancel."],
    customerEmail: "maria@example.com",
    successUrl: "http://localhost:3000/m/token?joined=1",
    cancelUrl: "http://localhost:3000/m/token",
    reference: "membership-1",
    idempotencyKey: "join-1",
  });
  const { events } = sim.completeCheckout(session.id, "pay");
  const subscription = subscriptions(events)[0]!;
  return { accountId, productId, priceId, session, events, subscription };
}

describe("simulated Stripe Billing (module 12)", () => {
  it("starts a subscription at checkout, with the first bill paid and the terms on the page", async () => {
    const { accountId, session, events, subscription } = await member();
    expect(session.url).toBe(`http://localhost:3000/sim/stripe/checkout/${session.id}`);
    expect(sim.checkoutView(session.id)).toMatchObject({
      mode: "subscription",
      interval: "month",
      status: "complete",
    });
    expect(subscription).toMatchObject({
      status: "active",
      reference: "membership-1",
      amountCents: 9_900,
      endsAt: null,
    });
    expect(invoices(events)[0]).toMatchObject({
      kind: "cycle",
      status: "paid",
      amountCents: 9_900,
      attempts: 1,
    });
    expect(await sim.subscriptionForCheckout(accountId, session.id)).toMatchObject({
      subscriptionId: subscription.subscriptionId,
    });
  });

  it("retries a declined renewal 3, 5 and 7 days later, then leaves it past due (C-49 AC 2)", async () => {
    const { accountId, subscription } = await member();
    const declined = sim.renewNow(subscription.subscriptionId, "decline");
    expect(subscriptions(declined)[0]!.status).toBe("past_due");
    let bill = invoices(declined)[0]!;
    expect(bill).toMatchObject({
      status: "retrying",
      attempts: 1,
      failure: "Your card was declined.",
    });
    expect(bill.nextAttemptAt!.getTime()).toBeGreaterThan(
      Date.now() + (RETRY_DAYS[0]! - 0.1) * DAY,
    );

    for (const attempt of [2, 3, 4]) {
      bill = invoices(sim.retryDueNow(subscription.subscriptionId))[0]!;
      expect(bill.attempts).toBe(attempt);
    }
    expect(bill).toMatchObject({ status: "failed", nextAttemptAt: null });
    // Never silently cancelled: it stays past due.
    expect((await sim.getSubscription(accountId, subscription.subscriptionId)).status).toBe(
      "past_due",
    );
  });

  it("pays what's owed when the member swaps the card in the portal (C-52)", async () => {
    const { accountId, subscription } = await member();
    sim.renewNow(subscription.subscriptionId, "decline");
    const portal = await sim.portalUrl(
      accountId,
      subscription.customerId,
      "http://localhost:3000/m/manage/x",
    );
    const sessionId = portal.split("/").pop()!;
    expect(sim.portalView(sessionId)).toMatchObject({
      status: "past_due",
      card: { last4: "4242", failing: true },
    });

    const events = sim.portalAction(sessionId, "update_card");
    expect(subscriptions(events)[0]).toMatchObject({ status: "active", cardLast4: "4444" });
    expect(invoices(events)[0]).toMatchObject({ status: "paid", attempts: 2 });
  });

  it("cancels at the end of the paid month, then ends; nothing more is billed", async () => {
    const { accountId, subscription } = await member();
    const cancelled = await sim.cancelSubscription(accountId, subscription.subscriptionId);
    expect(cancelled.status).toBe("active");
    expect(cancelled.endsAt?.getTime()).toBe(subscription.currentPeriodEnd?.getTime());
    const later = sim.advanceBilling(Date.now() + 40 * DAY);
    expect(subscriptions(later)[0]).toMatchObject({ status: "canceled" });
    expect(invoices(later)).toEqual([]);
  });

  it("bills nothing while paused, and resuming doesn't charge a catch-up", async () => {
    const { accountId, subscription } = await member();
    await sim.pauseSubscription(accountId, subscription.subscriptionId);
    expect(invoices(sim.advanceBilling(Date.now() + 70 * DAY))).toEqual([]);
    const resumed = await sim.resumeSubscription(accountId, subscription.subscriptionId);
    expect(resumed.status).toBe("active");
    expect(resumed.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());
  });

  it("prorates a plan change: the difference now on an upgrade, a credit on a downgrade", async () => {
    const { accountId, productId, subscription } = await member();
    const platinum = await sim.createPrice({
      accountId,
      productId,
      name: "Platinum",
      description: "",
      amountCents: 14_900,
      interval: "month",
      idempotencyKey: "p",
    });
    const up = await sim.changeSubscriptionPrice(
      accountId,
      subscription.subscriptionId,
      platinum.priceId,
    );
    expect(up.subscription.amountCents).toBe(14_900);
    // Almost the whole month is left, so nearly the full $50 difference.
    expect(up.invoice).toMatchObject({ kind: "proration", status: "paid" });
    expect(up.invoice!.amountCents).toBeGreaterThan(4_800);

    const basic = await sim.createPrice({
      accountId,
      productId,
      name: "Basic",
      description: "",
      amountCents: 4_900,
      interval: "month",
      idempotencyKey: "b",
    });
    const down = await sim.changeSubscriptionPrice(
      accountId,
      subscription.subscriptionId,
      basic.priceId,
    );
    expect(down.invoice).toBeNull();
    // The unused part of Platinum comes off the next $49 bill.
    const next = invoices(sim.renewNow(subscription.subscriptionId, "pay"))[0]!;
    expect(next.amountCents).toBeLessThan(4_900);
  });
});
