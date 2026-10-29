import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CARD_HOLD_DAYS, type PaymentCapture } from "@leadanchor/contracts";
import {
  type AccountState,
  type CheckoutInput,
  type CheckoutSession,
  type PaymentEvent,
  PaymentRefused,
  type PaymentState,
  type PaymentsProvider,
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
}

interface SimPayment {
  id: string;
  accountId: string;
  checkoutId: string;
  amountCents: number;
  status: "requires_capture" | "succeeded" | "canceled";
  holdExpiresAt: string | null;
}

interface Store {
  accounts: Record<string, SimAccount>;
  checkouts: Record<string, SimCheckout>;
  payments: Record<string, SimPayment>;
}

/** Stripe's test card: every simulated payment uses it, so no card number is ever typed. */
const TEST_CARD = { brand: "visa", last4: "4242" };
const CHECKOUT_TTL_MS = 24 * 3600_000;
const SETUP_STEPS = ["Add the bank account your payouts go to", "Confirm your identity"];

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
        state.status === "open"
          ? ("open" as const)
          : state.status === "expired"
            ? ("expired" as const)
            : ("complete" as const),
      lastFailure: checkout.failure,
    };
  }

  /** The customer's choice on the simulated checkout page, and the event Stripe would send for it. */
  completeCheckout(
    checkoutId: string,
    outcome: "pay" | "decline" | "cancel",
  ): { redirectUrl: string | null; event: PaymentEvent | null } {
    const store = this.read();
    const checkout = store.checkouts[checkoutId];
    if (!checkout) throw new PaymentRefused("That checkout doesn't exist.");
    if (outcome === "cancel") return { redirectUrl: checkout.cancelUrl, event: null };
    const current = stateOf(
      checkout,
      checkout.paymentId ? store.payments[checkout.paymentId] : undefined,
    );
    if (current.status !== "open") return { redirectUrl: checkout.successUrl, event: null };

    if (outcome === "decline") {
      this.write(
        (draft) =>
          (draft.checkouts[checkoutId]!.failure = "Your card was declined. Try another card."),
      );
      return { redirectUrl: null, event: this.paymentEvent(checkoutId) };
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
    return { redirectUrl: checkout.successUrl, event: this.paymentEvent(checkoutId) };
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

  private checkoutUrl(id: string) {
    return `${this.pageBase}/sim/stripe/checkout/${id}`;
  }

  private account(store: Store, accountId: string) {
    const account = store.accounts[accountId];
    if (!account) throw new PaymentRefused("That payments account doesn't exist.");
    return account;
  }

  private read(): Store {
    if (this.cache) return this.cache;
    this.cache = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, "utf8")) as Store)
      : { accounts: {}, checkouts: {}, payments: {} };
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
