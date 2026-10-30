import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { accountStateOf, invoiceStateOf, paymentStateOf, subscriptionStateOf } from "./stripe";

// Stripe objects carry dozens of fields; these fixtures hold only the ones the mapping reads.
const as = <T>(value: unknown) => value as T;
const T0 = 1_793_000_000; // seconds

describe("Stripe account → AccountState", () => {
  it("is active once charges are enabled", () => {
    const state = accountStateOf(
      as<Stripe.Account>({
        charges_enabled: true,
        payouts_enabled: false,
        details_submitted: true,
        requirements: { currently_due: ["external_account"] },
      }),
    );
    expect(state).toEqual({
      status: "active",
      chargesEnabled: true,
      payoutsEnabled: false,
      requirements: ["a bank account for payouts"],
    });
  });

  it("tells onboarding from restricted, and says what's missing in plain words once each", () => {
    const due = ["tos_acceptance.date", "individual.ssn_last_4", "individual.id_number", "x.y"];
    const onboarding = accountStateOf(
      as<Stripe.Account>({
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        requirements: { currently_due: due },
      }),
    );
    expect(onboarding.status).toBe("onboarding");
    expect(onboarding.requirements).toEqual([
      "accepting Stripe's terms",
      "an ID number (SSN or EIN)",
      "details Stripe asks for",
    ]);
    const restricted = accountStateOf(
      as<Stripe.Account>({
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: true,
        requirements: { currently_due: [] },
      }),
    );
    expect(restricted.status).toBe("restricted");
  });
});

describe("Stripe checkout → PaymentState", () => {
  const session = (overrides: Record<string, unknown>) =>
    as<Stripe.Checkout.Session>({
      id: "cs_test_1",
      status: "complete",
      amount_total: 5000,
      client_reference_id: "pay-1",
      metadata: { reference: "pay-1" },
      payment_intent: null,
      ...overrides,
    });
  const intent = (status: string, extra: Record<string, unknown> = {}) => ({
    id: "pi_1",
    status,
    last_payment_error: null,
    latest_charge: {
      payment_method_details: { card: { brand: "visa", last4: "4242", capture_before: T0 } },
    },
    ...extra,
  });

  it("is open until the customer pays, and expired when the page closed unpaid", () => {
    expect(paymentStateOf(session({ status: "open" })).status).toBe("open");
    expect(paymentStateOf(session({ status: "expired" })).status).toBe("expired");
  });

  it("reads a card hold with its expiry and the card", () => {
    const state = paymentStateOf(session({ payment_intent: intent("requires_capture") }));
    expect(state).toMatchObject({
      status: "held",
      paymentId: "pi_1",
      reference: "pay-1",
      amountCents: 5000,
      cardBrand: "visa",
      cardLast4: "4242",
      holdExpiresAt: new Date(T0 * 1000),
    });
  });

  it("tells a collected payment from a released hold", () => {
    expect(paymentStateOf(session({ payment_intent: intent("succeeded") })).status).toBe("paid");
    const released = paymentStateOf(session({ payment_intent: intent("canceled") }));
    expect(released.status).toBe("released");
    expect(released.holdExpiresAt).toBeNull();
  });

  it("keeps the decline message while the customer tries again", () => {
    const state = paymentStateOf(
      session({
        status: "open",
        payment_intent: intent("requires_payment_method", {
          last_payment_error: { message: "Your card was declined." },
        }),
      }),
    );
    expect(state).toMatchObject({ status: "open", failure: "Your card was declined." });
  });
});

describe("Stripe subscription → SubscriptionState", () => {
  const subscription = (overrides: Record<string, unknown>) =>
    as<Stripe.Subscription>({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      metadata: { reference: "mem-1" },
      cancel_at: null,
      cancel_at_period_end: false,
      ended_at: null,
      pause_collection: null,
      default_payment_method: { card: { brand: "mastercard", last4: "4444" } },
      items: {
        data: [
          {
            current_period_end: T0,
            price: { id: "price_1", unit_amount: 2900, recurring: { interval: "month" } },
          },
        ],
      },
      ...overrides,
    });

  it("reads an active plan with its next bill and card", () => {
    expect(subscriptionStateOf(subscription({}))).toEqual({
      subscriptionId: "sub_1",
      customerId: "cus_1",
      reference: "mem-1",
      priceId: "price_1",
      amountCents: 2900,
      interval: "month",
      status: "active",
      currentPeriodEnd: new Date(T0 * 1000),
      endsAt: null,
      cardBrand: "mastercard",
      cardLast4: "4444",
    });
  });

  it("counts paused collection as paused, and past due as past due", () => {
    expect(
      subscriptionStateOf(subscription({ pause_collection: { behavior: "void" } })).status,
    ).toBe("paused");
    expect(subscriptionStateOf(subscription({ status: "past_due" })).status).toBe("past_due");
    expect(subscriptionStateOf(subscription({ status: "unpaid" })).status).toBe("past_due");
  });

  it("keeps a cancellation running to the period's end, then ends it", () => {
    const ending = subscriptionStateOf(subscription({ cancel_at_period_end: true }));
    expect(ending).toMatchObject({ status: "active", endsAt: new Date(T0 * 1000) });
    const ended = subscriptionStateOf(subscription({ status: "canceled", ended_at: T0 - 100 }));
    expect(ended).toMatchObject({
      status: "canceled",
      currentPeriodEnd: null,
      endsAt: new Date((T0 - 100) * 1000),
    });
  });
});

describe("Stripe invoice → InvoiceState", () => {
  const invoice = (overrides: Record<string, unknown>) =>
    as<Stripe.Invoice>({
      id: "in_1",
      status: "open",
      billing_reason: "subscription_cycle",
      amount_due: 2900,
      attempt_count: 1,
      next_payment_attempt: T0,
      status_transitions: { paid_at: null },
      parent: { subscription_details: { subscription: "sub_1", metadata: { reference: "mem-1" } } },
      lines: { data: [{ period: { start: T0 - 2_592_000, end: T0 } }] },
      payments: {
        data: [
          {
            payment: {
              payment_intent: {
                last_payment_error: { message: "Your card has insufficient funds." },
              },
            },
          },
        ],
      },
      ...overrides,
    });

  it("ignores a bill Stripe hasn't tried yet, so it's never mistaken for a decline", () => {
    expect(invoiceStateOf(invoice({ status: "draft" }))).toBeNull();
    expect(invoiceStateOf(invoice({ attempt_count: 0 }))).toBeNull();
  });

  it("reads a declined bill Stripe will retry, with the decline message", () => {
    expect(invoiceStateOf(invoice({}))).toEqual({
      invoiceId: "in_1",
      subscriptionId: "sub_1",
      reference: "mem-1",
      kind: "cycle",
      amountCents: 2900,
      status: "retrying",
      attempts: 1,
      nextAttemptAt: new Date(T0 * 1000),
      periodStart: new Date((T0 - 2_592_000) * 1000),
      periodEnd: new Date(T0 * 1000),
      paidAt: null,
      failure: "Your card has insufficient funds.",
    });
  });

  it("marks a bill failed once retries stop, or when it's voided", () => {
    expect(invoiceStateOf(invoice({ next_payment_attempt: null }))).toMatchObject({
      status: "failed",
      nextAttemptAt: null,
    });
    expect(invoiceStateOf(invoice({ status: "void", next_payment_attempt: null }))).toMatchObject({
      status: "failed",
      failure: "Cancelled before it was paid.",
    });
  });

  it("reads a paid plan change as a proration", () => {
    const state = invoiceStateOf(
      invoice({
        status: "paid",
        billing_reason: "subscription_update",
        amount_due: 2000,
        next_payment_attempt: null,
        status_transitions: { paid_at: T0 },
      }),
    );
    expect(state).toMatchObject({
      kind: "proration",
      status: "paid",
      amountCents: 2000,
      paidAt: new Date(T0 * 1000),
      failure: null,
    });
  });
});
