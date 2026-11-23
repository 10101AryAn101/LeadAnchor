import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SimulatorPayments } from "./simulator";
import { PaymentRefused } from "./types";

let dir: string;
let sim: SimulatorPayments;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "la-payments-"));
  sim = new SimulatorPayments(join(dir, "payments.json"), "http://localhost:3000");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function activeAccount() {
  const { accountId } = await sim.createAccount({ businessName: "Demo Plumbing" });
  await sim.onboardingUrl(accountId, { returnUrl: "http://localhost:3000/settings" });
  sim.completeOnboarding(accountId, "finish");
  return accountId;
}

const checkout = (accountId: string, capture: "hold" | "charge", key = "pay-1") =>
  sim.createCheckout({
    accountId,
    amountCents: 5_000,
    description: "Deposit: Drain cleaning",
    businessName: "Demo Plumbing",
    capture,
    customerEmail: null,
    successUrl: "http://localhost:3000/pay/t?checkout=done",
    cancelUrl: "http://localhost:3000/pay/t",
    reference: "payment-1",
    idempotencyKey: key,
  });

describe("simulated Stripe (module 7)", () => {
  it("won't take cards until the business finishes its account setup", async () => {
    const { accountId } = await sim.createAccount({ businessName: "Demo Plumbing" });
    expect((await sim.getAccount(accountId)).chargesEnabled).toBe(false);
    await expect(checkout(accountId, "charge")).rejects.toBeInstanceOf(PaymentRefused);
    // The setup page opens on the owner's own address, so they stay signed in on the way back.
    expect(
      await sim.onboardingUrl(accountId, { returnUrl: "http://localhost:3000/settings#payments" }),
    ).toBe(`http://localhost:3000/sim/stripe/onboarding/${accountId}`);
    expect(sim.completeOnboarding(accountId, "finish").redirectUrl).toBe(
      "http://localhost:3000/settings#payments",
    );
    expect(await sim.getAccount(accountId)).toMatchObject({
      status: "active",
      chargesEnabled: true,
      requirements: [],
    });
  });

  it("holds a deposit on the card, then collects it (C-15)", async () => {
    const accountId = await activeAccount();
    const session = await checkout(accountId, "hold");
    expect(session.url).toBe(`http://localhost:3000/sim/stripe/checkout/${session.id}`);

    const { redirectUrl, events } = sim.completeCheckout(session.id, "pay");
    const event = events[0];
    expect(redirectUrl).toContain("checkout=done");
    expect(event?.type === "payment" && event.state).toMatchObject({
      status: "held",
      reference: "payment-1",
      cardLast4: "4242",
    });

    const held = await sim.getPayment(accountId, session.id);
    expect(held.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect((await sim.capture(accountId, held.paymentId!)).status).toBe("paid");
    await expect(sim.release(accountId, held.paymentId!)).rejects.toThrow("already collected");
  });

  it("lets a hold go, and a hold nobody collects lapses after 7 days", async () => {
    const accountId = await activeAccount();
    const first = await checkout(accountId, "hold", "a");
    sim.completeCheckout(first.id, "pay");
    const released = await sim.release(
      accountId,
      (await sim.getPayment(accountId, first.id)).paymentId!,
    );
    expect(released.status).toBe("released");

    const second = await checkout(accountId, "hold", "b");
    sim.completeCheckout(second.id, "pay");
    const paymentId = (await sim.getPayment(accountId, second.id)).paymentId!;
    sim.ageHold(paymentId, -1);
    expect((await sim.getPayment(accountId, second.id)).status).toBe("released");
    await expect(sim.capture(accountId, paymentId)).rejects.toThrow("hold has ended");
  });

  it("reports a declined card and keeps the checkout open for another try", async () => {
    const accountId = await activeAccount();
    const session = await checkout(accountId, "charge");
    const declined = sim.completeCheckout(session.id, "decline");
    expect(declined.redirectUrl).toBeNull();
    expect(await sim.getPayment(accountId, session.id)).toMatchObject({
      status: "open",
      failure: expect.stringContaining("declined"),
    });
    sim.completeCheckout(session.id, "pay");
    expect(await sim.getPayment(accountId, session.id)).toMatchObject({
      status: "paid",
      failure: null,
    });
  });

  it("reuses a checkout for the same idempotency key and survives a restart", async () => {
    const accountId = await activeAccount();
    const first = await checkout(accountId, "charge", "same");
    const again = await checkout(accountId, "charge", "same");
    expect(again.id).toBe(first.id);

    const restarted = new SimulatorPayments(join(dir, "payments.json"), "http://localhost:3000");
    expect((await restarted.getPayment(accountId, first.id)).status).toBe("open");
    await restarted.expireCheckout(accountId, first.id);
    expect((await restarted.getPayment(accountId, first.id)).status).toBe("expired");
  });
});
