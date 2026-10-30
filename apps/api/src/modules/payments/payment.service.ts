import {
  type ManualPaymentMethod,
  PAYMENT_METHOD_LABELS,
  type PaymentItem,
  type PaymentKind,
  type PaymentCapture,
  type PaymentRequestResult,
  type PaymentSettings,
  type PublicPayment,
  type paymentRecordInput,
  type paymentRequestInput,
  type paymentSettingsInput,
  formatPhone,
} from "@leadanchor/contracts";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { z } from "zod";
import { linkBaseUrl } from "../../config/env";
import { payments } from "../../container";
import { type Tx, systemDb, withTenant } from "../../db/client";
import {
  customers,
  leads,
  paymentAccounts,
  paymentRequests,
  phoneNumbers,
  tenants,
  webhookInbox,
} from "../../db/schema";
import { type Effects, tenantWork } from "../../db/unit-of-work";
import {
  type AccountState,
  type PaymentEvent,
  PaymentRefused,
  type PaymentState,
} from "../../integrations/payments/types";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../../lib/crypto";
import { HttpError, notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { iso } from "../../lib/time";
import { audit } from "../compliance/audit";
import { applyInvoiceState, applySubscriptionState } from "../memberships/billing";
import { addLeadEvent } from "../leads/lead-capture";
import { toMessageItem } from "../messaging/message-item";
import { requestEmail, requestMessage } from "../messaging/send-path";
import { notifyOwner } from "../notifications/notify";
import { profileUrl } from "../profile/profile";
import { canMove, cardLabel, dollars, receiptNumber, toCents } from "./money";

type PaymentRow = typeof paymentRequests.$inferSelect;
type AccountRow = typeof paymentAccounts.$inferSelect;
type Tenant = typeof tenants.$inferSelect;
type Customer = typeof customers.$inferSelect;
type Lead = typeof leads.$inferSelect;

interface Party {
  tenant: Tenant;
  lead: Lead;
  customer: Customer;
  account: AccountRow | null;
}

/** The customer's pay page (module 7): pay by card, or see how to pay by Zelle or Venmo. */
export const payUrl = (token: string) => `${linkBaseUrl}/pay/${token}`;

function linkOf(row: Pick<PaymentRow, "tokenSealed">) {
  if (!row.tokenSealed) return null;
  try {
    return payUrl(decryptSecret(row.tokenSealed));
  } catch {
    return null;
  }
}

const firstName = (customer: Customer) => customer.name?.trim().split(/\s+/)[0] ?? null;
const greeting = (customer: Customer) => (firstName(customer) ? `Hi ${firstName(customer)}` : "Hi");
const customerName = (customer: Customer) =>
  customer.name ?? (customer.phoneE164 ? formatPhone(customer.phoneE164) : "Your customer");

export function toPaymentItem(row: PaymentRow): PaymentItem {
  return {
    id: row.id,
    leadId: row.leadId,
    quoteId: row.quoteId,
    kind: row.kind,
    capture: row.capture,
    status: row.status,
    amountCents: row.amountCents,
    description: row.description,
    method: row.method,
    card: cardLabel(row.cardBrand, row.cardLast4),
    url: linkOf(row),
    heldAt: iso(row.heldAt),
    holdExpiresAt: iso(row.holdExpiresAt),
    paidAt: iso(row.paidAt),
    releasedAt: iso(row.releasedAt),
    canceledAt: iso(row.canceledAt),
    lastFailure: row.status === "open" ? row.lastFailure : null,
    reported:
      row.reportedMethod && row.reportedAt
        ? { method: row.reportedMethod, at: row.reportedAt.toISOString() }
        : null,
    note: row.note,
    receiptSentAt: iso(row.receiptSentAt),
    viewedAt: iso(row.viewedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/* ── The business's payments account ─────────────────────────────────────── */

async function accountOf(tx: Tx, tenantId: string) {
  const [row] = await tx
    .select()
    .from(paymentAccounts)
    .where(eq(paymentAccounts.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

/** Cards work when the account was opened with the payments provider in use and it may take charges. */
export const cardsReady = (
  account: AccountRow | null,
): account is AccountRow & { providerAccountId: string } =>
  Boolean(
    account &&
    account.provider === payments.name &&
    account.providerAccountId &&
    account.chargesEnabled,
  );

function toSettings(account: AccountRow | null): PaymentSettings {
  // An account opened with another provider (e.g. the simulator once Stripe is live) doesn't count.
  const current =
    account && account.provider === payments.name && account.providerAccountId ? account : null;
  return {
    provider: payments.name,
    status: current?.status ?? "not_connected",
    cardPayments: cardsReady(account),
    payouts: Boolean(current?.payoutsEnabled),
    requirements: current?.requirements ?? [],
    zelle: account?.zelle ?? null,
    venmo: account?.venmo ?? null,
    simulated: payments.name === "simulator",
  };
}

export async function getPaymentSettings(tenantId: string): Promise<PaymentSettings> {
  return withTenant(tenantId, async (tx) => toSettings(await accountOf(tx, tenantId)));
}

export async function updatePaymentSettings(
  tenantId: string,
  userId: string,
  input: z.output<typeof paymentSettingsInput>,
): Promise<PaymentSettings> {
  return tenantWork(tenantId, async (tx, fx) => {
    const patch: Partial<AccountRow> = {};
    if (input.zelle !== undefined) patch.zelle = input.zelle;
    if (input.venmo !== undefined) patch.venmo = input.venmo;
    if (Object.keys(patch).length === 0) return toSettings(await accountOf(tx, tenantId));

    const [row] = await tx
      .insert(paymentAccounts)
      .values({ tenantId, ...patch })
      .onConflictDoUpdate({ target: paymentAccounts.tenantId, set: patch })
      .returning();
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "payments.settings_updated",
      entityType: "payment_account",
      entityId: row!.id,
      data: { fields: Object.keys(patch) },
    });
    fx.publish({ type: "payments.updated" });
    return toSettings(row!);
  });
}

/**
 * Opens the business's own payments account (a Stripe Connect account) if it has none, and
 * returns the provider's hosted setup page. Bank and identity details go to the provider only.
 */
export async function connectPayments(
  tenantId: string,
  userId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const { tenant, account } = await withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    return { tenant: row!, account: await accountOf(tx, tenantId) };
  });

  let accountId = account?.provider === payments.name ? account.providerAccountId : null;
  if (!accountId) {
    const created = await payments.createAccount({
      tenantId,
      businessName: tenant.name,
      email: null,
    });
    accountId = created.accountId;
    const opened = {
      provider: payments.name,
      providerAccountId: accountId,
      status: "onboarding" as const,
      chargesEnabled: false,
      payoutsEnabled: false,
      requirements: [],
    };
    await tenantWork(tenantId, async (tx, fx) => {
      const [row] = await tx
        .insert(paymentAccounts)
        .values({ tenantId, ...opened })
        .onConflictDoUpdate({ target: paymentAccounts.tenantId, set: opened })
        .returning();
      await audit(tx, {
        tenantId,
        actor: `user:${userId}`,
        action: "payments.account_opened",
        entityType: "payment_account",
        entityId: row!.id,
        data: { provider: payments.name },
      });
      fx.publish({ type: "payments.updated" });
    });
  }
  return { url: await payments.onboardingUrl(accountId, { returnUrl, refreshUrl: returnUrl }) };
}

/** Asks the provider where the account stands (after the owner comes back from its setup page). */
export async function refreshPaymentAccount(tenantId: string): Promise<PaymentSettings> {
  const account = await withTenant(tenantId, (tx) => accountOf(tx, tenantId));
  if (!account?.providerAccountId || account.provider !== payments.name) return toSettings(account);
  return applyAccountState(
    tenantId,
    account.id,
    await payments.getAccount(account.providerAccountId),
  );
}

async function applyAccountState(
  tenantId: string,
  accountRowId: string,
  state: AccountState,
): Promise<PaymentSettings> {
  return tenantWork(tenantId, async (tx, fx) => {
    const [before] = await tx
      .select()
      .from(paymentAccounts)
      .where(eq(paymentAccounts.id, accountRowId))
      .for("update");
    if (!before) throw notFound("Payments account");
    const [row] = await tx
      .update(paymentAccounts)
      .set({
        status: state.status,
        chargesEnabled: state.chargesEnabled,
        payoutsEnabled: state.payoutsEnabled,
        requirements: state.requirements,
        lastSyncedAt: new Date(),
      })
      .where(eq(paymentAccounts.id, accountRowId))
      .returning();
    if (before.chargesEnabled !== state.chargesEnabled) {
      await audit(tx, {
        tenantId,
        actor: "system",
        action: state.chargesEnabled ? "payments.cards_enabled" : "payments.cards_disabled",
        entityType: "payment_account",
        entityId: accountRowId,
        data: { status: state.status },
      });
      await notifyOwner(tx, fx, {
        tenantId,
        kind: "payment",
        title: state.chargesEnabled ? "Card payments are on" : "Card payments are paused",
        body: state.chargesEnabled
          ? "Customers can now pay deposits and bills by card. The money goes straight to your bank account."
          : `Your payments provider needs something from you: ${state.requirements.join("; ") || "open Settings to see what"}.`,
      });
    }
    fx.publish({ type: "payments.updated" });
    return toSettings(row!);
  });
}

/* ── Pay links (owner) ───────────────────────────────────────────────────── */

async function partyFor(tx: Tx, leadId: string): Promise<Party> {
  const [row] = await tx
    .select({ lead: leads, customer: customers, tenant: tenants })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .innerJoin(tenants, eq(tenants.id, leads.tenantId))
    .where(eq(leads.id, leadId));
  if (!row) throw notFound("Lead");
  return { ...row, account: await accountOf(tx, row.tenant.id) };
}

/** A new pay link. Every row gets one, so even a payment recorded by hand has a receipt page. */
export async function insertPaymentRequest(
  tx: Tx,
  input: {
    tenantId: string;
    leadId: string;
    customerId: string;
    quoteId?: string | null;
    kind: PaymentKind;
    capture: PaymentCapture;
    amountCents: number;
    description: string;
    createdBy: string;
  },
): Promise<{ row: PaymentRow; token: string }> {
  const token = randomToken();
  const [row] = await tx
    .insert(paymentRequests)
    .values({
      ...input,
      quoteId: input.quoteId ?? null,
      status: "open",
      tokenHash: sha256(token),
      tokenSealed: encryptSecret(token),
      provider: payments.name,
    })
    .returning();
  return { row: row!, token };
}

/** "by card, Zelle or Venmo". */
function payWays(party: Party) {
  const ways = [
    cardsReady(party.account) ? "card" : null,
    party.account?.zelle ? "Zelle" : null,
    party.account?.venmo ? "Venmo" : null,
  ].filter(Boolean) as string[];
  return ways.length <= 1
    ? ways[0]
      ? `by ${ways[0]}`
      : ""
    : `by ${ways.slice(0, -1).join(", ")} or ${ways.at(-1)}`;
}

async function saveEmail(tx: Tx, customer: Customer, email: string) {
  if (customer.email?.toLowerCase() !== email.toLowerCase())
    await tx.update(customers).set({ email }).where(eq(customers.id, customer.id));
}

/** C-26: the pay-link message, as a text and/or an email through the governed send path. */
async function sendPayLink(
  tx: Tx,
  fx: Effects,
  party: Party,
  row: PaymentRow,
  send: { text: boolean; email?: string | null },
) {
  const url = linkOf(row)!;
  const { tenant, customer } = party;
  const ways = payWays(party);
  const hold = row.capture === "hold" ? " Your card is only held until the work goes ahead." : "";
  const line =
    row.kind === "deposit"
      ? `To lock in your booking, please pay the ${dollars(row.amountCents)} deposit${ways ? ` ${ways}` : ""}: ${url}${hold}`
      : `Here's your bill for ${row.description}: ${dollars(row.amountCents)}. Pay${ways ? ` ${ways}` : ""} here: ${url}`;

  const sent = [];
  if (send.text && customer.phoneE164) {
    sent.push(
      await requestMessage(tx, fx, {
        tenant,
        customerId: customer.id,
        leadId: row.leadId,
        to: customer.phoneE164,
        purpose: "transactional",
        body: `${greeting(customer)}, ${row.kind === "deposit" ? `it's ${tenant.name}.` : `thanks for choosing ${tenant.name}!`} ${line}\nReply STOP to opt out.`,
      }),
    );
  }
  if (send.email) {
    await saveEmail(tx, customer, send.email);
    sent.push(
      await requestEmail(tx, fx, {
        tenant,
        customerId: customer.id,
        leadId: row.leadId,
        to: send.email,
        purpose: "transactional",
        subject:
          row.kind === "deposit"
            ? `Deposit for your booking with ${tenant.name}`
            : `Your bill from ${tenant.name}`,
        body: `${greeting(customer)},\n\n${row.kind === "deposit" ? `Thanks for booking with ${tenant.name}.` : `Thanks for choosing ${tenant.name}.`} ${line}\n\n${tenant.name}`,
      }),
    );
  }
  return sent;
}

/** C-15 / C-26: ask for a deposit or a payment with a pay link. */
export async function requestPayment(
  tenantId: string,
  userId: string,
  leadId: string,
  input: z.output<typeof paymentRequestInput>,
): Promise<PaymentRequestResult> {
  if (input.collectHeld) {
    const held = await withTenant(tenantId, (tx) =>
      tx
        .select({ id: paymentRequests.id })
        .from(paymentRequests)
        .where(and(eq(paymentRequests.leadId, leadId), eq(paymentRequests.status, "held"))),
    );
    for (const row of held) await capturePayment(tenantId, userId, row.id);
  }

  return tenantWork(tenantId, async (tx, fx) => {
    const party = await partyFor(tx, leadId);
    const cards = cardsReady(party.account);
    if (!cards && !party.account?.zelle && !party.account?.venmo) {
      throw new HttpError(
        409,
        "payments_not_set_up",
        "First choose how customers pay you: turn on card payments, or add Zelle or Venmo, in Settings → Getting paid.",
      );
    }
    if (input.capture === "hold" && !cards)
      throw new HttpError(
        422,
        "cards_off",
        "Holding a deposit on a card needs card payments turned on.",
      );

    const { row } = await insertPaymentRequest(tx, {
      tenantId,
      leadId,
      customerId: party.customer.id,
      kind: input.kind,
      capture: input.kind === "deposit" ? input.capture : "charge",
      amountCents: toCents(input.amountDollars),
      description: input.description,
      createdBy: `user:${userId}`,
    });
    await addLeadEvent(tx, {
      tenantId,
      leadId,
      type: "payment.requested",
      actor: `user:${userId}`,
      data: {
        paymentId: row.id,
        kind: row.kind,
        capture: row.capture,
        amountCents: row.amountCents,
        description: row.description,
      },
    });
    const sent = await sendPayLink(tx, fx, party, row, input.send);
    fx.publish({ type: "lead.updated", leadId });
    return { payment: toPaymentItem(row), messages: sent.map(toMessageItem) };
  });
}

export async function resendPaymentLink(
  tenantId: string,
  userId: string,
  paymentId: string,
  send: { text: boolean; email?: string | null },
): Promise<PaymentRequestResult> {
  return tenantWork(tenantId, async (tx, fx) => {
    const row = await rowOf(tx, paymentId);
    if (row.status !== "open")
      throw new HttpError(
        409,
        "not_open",
        "This pay link is closed: there's nothing left to pay on it.",
      );
    const party = await partyFor(tx, row.leadId);
    const sent = await sendPayLink(tx, fx, party, row, send);
    await addLeadEvent(tx, {
      tenantId,
      leadId: row.leadId,
      type: "payment.resent",
      actor: `user:${userId}`,
      data: { paymentId, amountCents: row.amountCents },
    });
    fx.publish({ type: "lead.updated", leadId: row.leadId });
    return { payment: toPaymentItem(row), messages: sent.map(toMessageItem) };
  });
}

async function rowOf(tx: Tx, paymentId: string, lock = false) {
  const query = tx.select().from(paymentRequests).where(eq(paymentRequests.id, paymentId));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw notFound("Payment");
  return row;
}

/** The provider account a card payment went through, if it is still the one in use. */
async function providerAccountFor(tenantId: string, row: PaymentRow) {
  const account = await withTenant(tenantId, (tx) => accountOf(tx, tenantId));
  if (!account?.providerAccountId || account.provider !== row.provider) return null;
  return account.providerAccountId;
}

/** C-15: collect a deposit that is on hold. */
export async function capturePayment(
  tenantId: string,
  userId: string,
  paymentId: string,
): Promise<PaymentItem> {
  const row = await withTenant(tenantId, (tx) => rowOf(tx, paymentId));
  if (row.status === "paid") return toPaymentItem(row);
  if (row.status !== "held" || !row.providerPaymentId)
    throw new HttpError(409, "not_held", "There's no hold on this payment to collect.");
  const accountId = await providerAccountFor(tenantId, row);
  if (!accountId)
    throw new HttpError(
      409,
      "account_changed",
      "This hold was placed through a payments account that's no longer connected.",
    );
  try {
    return await applyPaymentState(
      tenantId,
      row.id,
      await payments.capture(accountId, row.providerPaymentId),
      { actor: `user:${userId}` },
    );
  } catch (error) {
    if (!(error instanceof PaymentRefused)) throw error;
    // Bring our record in line with the provider first (e.g. the hold had already ended).
    await reconcilePayment(tenantId, row.id).catch(() => undefined);
    throw new HttpError(409, "payment_refused", error.message);
  }
}

/** C-15: let a hold go without charging the card. */
export async function releasePayment(
  tenantId: string,
  userId: string,
  paymentId: string,
): Promise<PaymentItem> {
  const row = await withTenant(tenantId, (tx) => rowOf(tx, paymentId));
  if (row.status === "released") return toPaymentItem(row);
  if (row.status !== "held" || !row.providerPaymentId)
    throw new HttpError(409, "not_held", "There's no hold on this payment to release.");
  const accountId = await providerAccountFor(tenantId, row);
  if (!accountId)
    throw new HttpError(
      409,
      "account_changed",
      "This hold was placed through a payments account that's no longer connected.",
    );
  try {
    return await applyPaymentState(
      tenantId,
      row.id,
      await payments.release(accountId, row.providerPaymentId),
      { actor: `user:${userId}` },
    );
  } catch (error) {
    if (!(error instanceof PaymentRefused)) throw error;
    await reconcilePayment(tenantId, row.id).catch(() => undefined);
    throw new HttpError(409, "payment_refused", error.message);
  }
}

/** Closes an unpaid pay link. If the customer paid at that very moment, the payment stands. */
export async function cancelPaymentRequest(
  tenantId: string,
  userId: string,
  paymentId: string,
): Promise<PaymentItem> {
  const row = await withTenant(tenantId, (tx) => rowOf(tx, paymentId));
  if (row.status === "canceled") return toPaymentItem(row);
  if (row.status === "held")
    throw new HttpError(
      409,
      "held",
      "This deposit is on hold on the customer's card. Release the hold instead.",
    );
  if (row.status !== "open")
    throw new HttpError(409, "not_open", "This pay link is already closed.");

  if (row.providerCheckoutId) {
    const accountId = await providerAccountFor(tenantId, row);
    if (accountId) {
      await payments.expireCheckout(accountId, row.providerCheckoutId).catch(() => undefined);
      const state = await payments.getPayment(accountId, row.providerCheckoutId);
      if (state.status === "held" || state.status === "paid") {
        await applyPaymentState(tenantId, row.id, state);
        throw new HttpError(409, "just_paid", "The customer has just paid this one, so it stays.");
      }
    }
  }

  return tenantWork(tenantId, async (tx, fx) => {
    const locked = await rowOf(tx, paymentId, true);
    if (!canMove(locked.status, "canceled")) return toPaymentItem(locked);
    const [updated] = await tx
      .update(paymentRequests)
      .set({ status: "canceled", canceledAt: new Date(), checkoutUrl: null })
      .where(eq(paymentRequests.id, paymentId))
      .returning();
    await addLeadEvent(tx, {
      tenantId,
      leadId: locked.leadId,
      type: "payment.canceled",
      actor: `user:${userId}`,
      data: { paymentId, amountCents: locked.amountCents },
    });
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "payment.canceled",
      entityType: "payment",
      entityId: paymentId,
      data: { amountCents: locked.amountCents },
    });
    fx.publish({ type: "lead.updated", leadId: locked.leadId });
    return toPaymentItem(updated!);
  });
}

/**
 * Money that arrived outside the card checkout: Zelle, Venmo, cash or a check. Nothing reports
 * those back on its own, so the owner marks them received; a pay link they settle is closed.
 */
export async function recordPayment(
  tenantId: string,
  userId: string,
  leadId: string,
  input: z.output<typeof paymentRecordInput>,
): Promise<PaymentItem> {
  const result = await tenantWork(tenantId, async (tx, fx) => {
    const party = await partyFor(tx, leadId);
    const amountCents = toCents(input.amountDollars);
    const paid = {
      status: "paid" as const,
      paidAt: new Date(),
      method: input.method,
      note: input.note ?? null,
      amountCents,
      checkoutUrl: null,
    };
    let row: PaymentRow;
    let closeCheckout: string | null = null;

    if (input.requestId) {
      const existing = await rowOf(tx, input.requestId, true);
      if (existing.leadId !== leadId) throw notFound("Payment");
      if (existing.status !== "open")
        throw new HttpError(409, "not_open", "That pay link is already closed.");
      [row] = (await tx
        .update(paymentRequests)
        .set(paid)
        .where(eq(paymentRequests.id, existing.id))
        .returning()) as [PaymentRow];
      closeCheckout = existing.providerCheckoutId;
    } else {
      const created = await insertPaymentRequest(tx, {
        tenantId,
        leadId,
        customerId: party.customer.id,
        kind: "payment",
        capture: "charge",
        amountCents,
        description: input.note?.trim() || party.lead.title,
        createdBy: `user:${userId}`,
      });
      [row] = (await tx
        .update(paymentRequests)
        .set({ ...paid, provider: "manual" })
        .where(eq(paymentRequests.id, created.row.id))
        .returning()) as [PaymentRow];
    }

    await addLeadEvent(tx, {
      tenantId,
      leadId,
      type: "payment.paid",
      actor: `user:${userId}`,
      data: { paymentId: row.id, amountCents, method: input.method, recorded: true },
    });
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "payment.recorded",
      entityType: "payment",
      entityId: row.id,
      data: { amountCents, method: input.method },
    });
    await sendReceipt(tx, fx, party, row);
    fx.publish({ type: "lead.updated", leadId });
    return { row, closeCheckout };
  });

  if (result.closeCheckout) {
    const accountId = await providerAccountFor(tenantId, result.row);
    if (accountId)
      await payments.expireCheckout(accountId, result.closeCheckout).catch(() => undefined);
  }
  return toPaymentItem(result.row);
}

/* ── Status from the provider: webhooks, the return from checkout, the reconciliation job ── */

/**
 * Applies what the provider says about a payment. Webhooks, the customer's return from the
 * checkout page and the reconciliation job all end here, so a repeated or late report changes
 * nothing: a payment only moves forward (open → held → paid or released).
 */
export async function applyPaymentState(
  tenantId: string,
  paymentId: string,
  state: PaymentState,
  options: { actor?: string } = {},
): Promise<PaymentItem> {
  return tenantWork(tenantId, async (tx, fx) => {
    const row = await rowOf(tx, paymentId, true);
    const now = new Date();
    const byOwner = options.actor?.startsWith("user:") ?? false;
    const current = !row.providerCheckoutId || state.checkoutId === row.providerCheckoutId;
    const card = {
      method: "card" as const,
      cardBrand: state.cardBrand,
      cardLast4: state.cardLast4,
      providerPaymentId: state.paymentId,
      providerCheckoutId: state.checkoutId,
    };
    let patch: Partial<PaymentRow> = { lastCheckedAt: now };
    let event: { type: string; data: Record<string, unknown> } | null = null;

    switch (state.status) {
      case "open":
        if (
          current &&
          state.failure &&
          state.failure !== row.lastFailure &&
          row.status === "open"
        ) {
          patch.lastFailure = state.failure;
          event = {
            type: "payment.failed",
            data: { paymentId, amountCents: row.amountCents, reason: state.failure },
          };
        }
        break;
      case "expired":
        // The checkout page closed unpaid; the pay link opens a fresh one next time.
        if (current && row.status === "open")
          patch = {
            ...patch,
            providerCheckoutId: null,
            checkoutUrl: null,
            checkoutExpiresAt: null,
          };
        break;
      case "held":
        if (canMove(row.status, "held")) {
          patch = {
            ...patch,
            ...card,
            status: "held",
            heldAt: now,
            holdExpiresAt: state.holdExpiresAt,
            lastFailure: null,
            checkoutUrl: null,
          };
          event = {
            type: "payment.held",
            data: {
              paymentId,
              amountCents: row.amountCents,
              card: cardLabel(state.cardBrand, state.cardLast4),
            },
          };
        } else if (
          row.status === "held" &&
          state.holdExpiresAt &&
          state.holdExpiresAt.getTime() !== row.holdExpiresAt?.getTime()
        ) {
          patch.holdExpiresAt = state.holdExpiresAt;
        }
        break;
      case "paid":
        if (canMove(row.status, "paid")) {
          patch = {
            ...patch,
            ...card,
            status: "paid",
            paidAt: now,
            lastFailure: null,
            checkoutUrl: null,
          };
          event = {
            type: "payment.paid",
            data: {
              paymentId,
              amountCents: state.amountCents,
              method: "card",
              card: cardLabel(state.cardBrand, state.cardLast4),
              collected: row.status === "held",
            },
          };
        }
        break;
      case "released":
        if (canMove(row.status, "released")) {
          patch = { ...patch, status: "released", releasedAt: now };
          event = {
            type: "payment.released",
            data: {
              paymentId,
              amountCents: row.amountCents,
              reason: byOwner ? "owner" : "expired",
            },
          };
        }
        break;
    }

    const [updated] = await tx
      .update(paymentRequests)
      .set(patch)
      .where(eq(paymentRequests.id, paymentId))
      .returning();
    if (!event) return toPaymentItem(updated!);

    const actor = options.actor ?? "system";
    await addLeadEvent(tx, {
      tenantId,
      leadId: row.leadId,
      type: event.type,
      actor,
      data: event.data,
    });
    if (byOwner)
      await audit(tx, {
        tenantId,
        actor,
        action: event.type,
        entityType: "payment",
        entityId: paymentId,
        data: event.data,
      });

    const party = await partyFor(tx, row.leadId);
    const name = customerName(party.customer);
    if (updated!.status === "held" || updated!.status === "paid")
      await sendReceipt(tx, fx, party, updated!);

    if (!byOwner && event.type === "payment.held") {
      await notifyOwner(tx, fx, {
        tenantId,
        kind: "payment",
        title: `Deposit secured: ${dollars(row.amountCents)}`,
        body: `${name} put a ${dollars(row.amountCents)} hold on their card for ${row.description}. Collect it when the work goes ahead.`,
        leadId: row.leadId,
      });
    } else if (!byOwner && event.type === "payment.paid") {
      await notifyOwner(tx, fx, {
        tenantId,
        kind: "payment",
        title: `${name} paid ${dollars(state.amountCents)}`,
        body: `${row.description}, by card.`,
        leadId: row.leadId,
      });
    } else if (!byOwner && event.type === "payment.released") {
      await notifyOwner(tx, fx, {
        tenantId,
        kind: "payment",
        title: `A ${dollars(row.amountCents)} hold ended`,
        body: `${name}'s deposit hold for ${row.description} ran out without being collected. Send a new pay link if you still need it.`,
        leadId: row.leadId,
      });
    }
    fx.publish({ type: "lead.updated", leadId: row.leadId });
    return toPaymentItem(updated!);
  });
}

/** Asks the provider about one payment and records the answer. */
export async function reconcilePayment(tenantId: string, paymentId: string) {
  const row = await withTenant(tenantId, (tx) => rowOf(tx, paymentId));
  if (!row.providerCheckoutId) return toPaymentItem(row);
  const accountId = await providerAccountFor(tenantId, row);
  if (!accountId) return toPaymentItem(row);
  return applyPaymentState(
    tenantId,
    row.id,
    await payments.getPayment(accountId, row.providerCheckoutId),
  );
}

/** A provider event (Stripe webhook, or the simulator acting like one). Each event is handled once. */
export async function receivePaymentEvent(event: PaymentEvent) {
  const provider = `payments.${payments.name}`;
  const [stored] = await systemDb
    .insert(webhookInbox)
    .values({ provider, eventId: event.id, eventType: event.type, payload: event })
    .onConflictDoNothing()
    .returning({ id: webhookInbox.id });
  if (!stored) return;

  const [account] = await systemDb
    .select({ id: paymentAccounts.id, tenantId: paymentAccounts.tenantId })
    .from(paymentAccounts)
    .where(
      and(
        eq(paymentAccounts.provider, payments.name),
        eq(paymentAccounts.providerAccountId, event.accountId),
      ),
    )
    .limit(1);
  try {
    if (!account) {
      await systemDb
        .update(webhookInbox)
        .set({ status: "ignored", processedAt: new Date() })
        .where(eq(webhookInbox.id, stored.id));
      return;
    }
    if (event.type === "account")
      await applyAccountState(account.tenantId, account.id, event.account);
    else if (event.type === "payment")
      await applyPaymentState(account.tenantId, event.state.reference, event.state);
    // Memberships (module 12): Stripe Billing's subscription and invoice events.
    else if (event.type === "subscription")
      await applySubscriptionState(account.tenantId, event.subscription);
    else await applyInvoiceState(account.tenantId, event.invoice);
    await systemDb
      .update(webhookInbox)
      .set({ status: "processed", processedAt: new Date(), tenantId: account.tenantId })
      .where(eq(webhookInbox.id, stored.id));
  } catch (error) {
    logger.error({ err: error, eventId: event.id }, "payment event failed");
    await systemDb
      .update(webhookInbox)
      .set({
        status: "failed",
        error: (error as Error).message.slice(0, 1000),
        tenantId: account?.tenantId ?? null,
      })
      .where(eq(webhookInbox.id, stored.id));
    throw error;
  }
}

/** C-15 "receipt logged": a text (or email) to the customer once a hold is placed or money arrives. */
async function sendReceipt(tx: Tx, fx: Effects, party: Party, row: PaymentRow) {
  const { tenant, customer } = party;
  const url = linkOf(row);
  const card = cardLabel(row.cardBrand, row.cardLast4);
  const body =
    row.status === "held"
      ? `${greeting(customer)}, your ${dollars(row.amountCents)} deposit for ${tenant.name} is on hold on your ${card ?? "card"}. You're only charged when the work goes ahead.${url ? ` Details: ${url}` : ""}`
      : `${greeting(customer)}, thank you! ${tenant.name} received your ${dollars(row.amountCents)} payment${row.method && row.method !== "card" ? ` by ${PAYMENT_METHOD_LABELS[row.method]}` : ""}. Receipt ${receiptNumber(row.id)}${url ? `: ${url}` : "."}`;

  let delivered = false;
  if (customer.phoneE164) {
    const message = await requestMessage(tx, fx, {
      tenant,
      customerId: customer.id,
      leadId: row.leadId,
      to: customer.phoneE164,
      purpose: "transactional",
      body,
    });
    delivered = message.status !== "blocked";
  }
  if (!delivered && customer.email) {
    await requestEmail(tx, fx, {
      tenant,
      customerId: customer.id,
      leadId: row.leadId,
      to: customer.email,
      purpose: "transactional",
      subject:
        row.status === "held" ? `Deposit on hold: ${tenant.name}` : `Receipt from ${tenant.name}`,
      body: `${body}\n\n${tenant.name}`,
    });
    delivered = true;
  }
  if (delivered)
    await tx
      .update(paymentRequests)
      .set({ receiptSentAt: new Date() })
      .where(eq(paymentRequests.id, row.id));
}

/* ── The customer's pay page ─────────────────────────────────────────────── */

async function resolvePay(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound("Link");
  const [row] = await systemDb
    .select()
    .from(paymentRequests)
    .where(eq(paymentRequests.tokenHash, sha256(token)))
    .limit(1);
  if (!row) throw notFound("Link");
  return row;
}

/** What the customer may see about the business: its own details, never anyone else's. */
export async function publicBusinessOf(tenant: Tenant) {
  const [number] = await systemDb
    .select({ e164: phoneNumbers.e164 })
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.tenantId, tenant.id), eq(phoneNumbers.status, "active")))
    .limit(1);
  return {
    name: tenant.name,
    trade: tenant.trade,
    phone: number?.e164 ?? null,
    city: tenant.city,
    state: tenant.state,
    licenseNumber: tenant.licenseNumber,
    insuranceCarrier: tenant.insuranceCarrier,
    yearsInBusiness: tenant.yearsInBusiness,
    profileUrl: profileUrl(tenant.slug),
  };
}

async function publicView(row: PaymentRow): Promise<PublicPayment> {
  const [[tenant], [customer], [account]] = await Promise.all([
    systemDb.select().from(tenants).where(eq(tenants.id, row.tenantId)),
    systemDb.select().from(customers).where(eq(customers.id, row.customerId)),
    systemDb.select().from(paymentAccounts).where(eq(paymentAccounts.tenantId, row.tenantId)),
  ]);
  return {
    business: await publicBusinessOf(tenant!),
    customerName: customer?.name ?? null,
    kind: row.kind,
    capture: row.capture,
    status: row.status,
    amountCents: row.amountCents,
    description: row.description,
    method: row.method,
    card: cardLabel(row.cardBrand, row.cardLast4),
    heldAt: iso(row.heldAt),
    holdExpiresAt: iso(row.holdExpiresAt),
    paidAt: iso(row.paidAt),
    receiptNumber: receiptNumber(row.id),
    cardPayments: cardsReady(account ?? null),
    zelle: account?.zelle ?? null,
    venmo: account?.venmo ?? null,
    reported:
      row.reportedMethod && row.reportedAt
        ? { method: row.reportedMethod, at: row.reportedAt.toISOString() }
        : null,
    lastFailure: row.status === "open" ? row.lastFailure : null,
    simulated: payments.name === "simulator",
  };
}

export async function getPublicPayment(token: string): Promise<PublicPayment> {
  const row = await resolvePay(token);
  if (!row.viewedAt && row.status === "open") {
    await tenantWork(row.tenantId, async (tx, fx) => {
      const [first] = await tx
        .update(paymentRequests)
        .set({ viewedAt: new Date() })
        .where(and(eq(paymentRequests.id, row.id), isNull(paymentRequests.viewedAt)))
        .returning({ id: paymentRequests.id });
      if (!first) return;
      await addLeadEvent(tx, {
        tenantId: row.tenantId,
        leadId: row.leadId,
        type: "payment.viewed",
        actor: "customer",
        data: { paymentId: row.id },
      });
      fx.publish({ type: "lead.updated", leadId: row.leadId });
    });
  }
  return publicView(row);
}

/** The customer tapped Pay: open (or reuse) the provider's hosted checkout. */
export async function startCheckout(token: string): Promise<{ url: string }> {
  const row = await resolvePay(token);
  if (row.status === "paid" || row.status === "held")
    throw new HttpError(409, "already_paid", "This is already paid. Thank you!");
  if (row.status !== "open")
    throw new HttpError(409, "closed", "This pay link is closed. Ask the business for a new one.");
  const [account] = await systemDb
    .select()
    .from(paymentAccounts)
    .where(eq(paymentAccounts.tenantId, row.tenantId));
  if (!cardsReady(account ?? null))
    throw new HttpError(409, "cards_off", "This business doesn't take cards online yet.");
  const accountId = account!.providerAccountId!;

  if (
    row.providerCheckoutId &&
    row.checkoutUrl &&
    row.checkoutExpiresAt &&
    row.checkoutExpiresAt.getTime() > Date.now() + 10 * 60_000
  ) {
    const state = await payments.getPayment(accountId, row.providerCheckoutId);
    if (state.status === "open") return { url: row.checkoutUrl };
    await applyPaymentState(row.tenantId, row.id, state);
    if (state.status === "held" || state.status === "paid")
      throw new HttpError(409, "already_paid", "This is already paid. Thank you!");
  } else if (row.providerCheckoutId) {
    // Only one checkout may be open at a time, so the customer can't pay twice.
    await payments.expireCheckout(accountId, row.providerCheckoutId).catch(() => undefined);
  }

  const [[tenant], [customer]] = await Promise.all([
    systemDb.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, row.tenantId)),
    systemDb
      .select({ email: customers.email })
      .from(customers)
      .where(eq(customers.id, row.customerId)),
  ]);
  const back = payUrl(token);
  const session = await payments.createCheckout({
    accountId,
    amountCents: row.amountCents,
    description: row.kind === "deposit" ? `Deposit: ${row.description}` : row.description,
    businessName: tenant!.name,
    capture: row.capture,
    customerEmail: customer?.email ?? null,
    successUrl: `${back}?checkout=done`,
    cancelUrl: back,
    reference: row.id,
    // Taps within the same minute reuse one checkout instead of opening several.
    idempotencyKey: `${row.id}:${Math.floor(Date.now() / 60_000)}`,
  });
  await withTenant(row.tenantId, (tx) =>
    tx
      .update(paymentRequests)
      .set({
        providerCheckoutId: session.id,
        checkoutUrl: session.url,
        checkoutExpiresAt: session.expiresAt,
        provider: payments.name,
      })
      .where(eq(paymentRequests.id, row.id)),
  );
  return { url: session.url };
}

/** Back from the checkout page: check with the provider straight away rather than wait for its webhook. */
export async function syncPublicPayment(token: string): Promise<PublicPayment> {
  const row = await resolvePay(token);
  if (row.providerCheckoutId && (row.status === "open" || row.status === "held"))
    await reconcilePayment(row.tenantId, row.id).catch(() => undefined);
  return publicView(await resolvePay(token));
}

/** "I've paid by Zelle / Venmo": nothing reports those back, so the owner is asked to check. */
export async function reportPayment(
  token: string,
  method: Extract<ManualPaymentMethod, "zelle" | "venmo">,
): Promise<PublicPayment> {
  const row = await resolvePay(token);
  if (row.status !== "open") return publicView(row);
  if (row.reportedMethod !== method) {
    await tenantWork(row.tenantId, async (tx, fx) => {
      await tx
        .update(paymentRequests)
        .set({ reportedMethod: method, reportedAt: new Date() })
        .where(eq(paymentRequests.id, row.id));
      await addLeadEvent(tx, {
        tenantId: row.tenantId,
        leadId: row.leadId,
        type: "payment.reported",
        actor: "customer",
        data: { paymentId: row.id, method, amountCents: row.amountCents },
      });
      const party = await partyFor(tx, row.leadId);
      await notifyOwner(tx, fx, {
        tenantId: row.tenantId,
        kind: "payment",
        title: `${customerName(party.customer)} says they paid ${dollars(row.amountCents)}`,
        body: `By ${PAYMENT_METHOD_LABELS[method]}, for ${row.description}. Check it arrived, then mark it received.`,
        leadId: row.leadId,
      });
      fx.publish({ type: "lead.updated", leadId: row.leadId });
    });
  }
  return publicView(await resolvePay(token));
}

/* ── Scheduled: reconciliation and hold reminders ────────────────────────── */

const RECHECK_MS = 10 * 60_000;

/**
 * Every 15 minutes (module 7 "status reconciliation"): re-check open checkouts and holds with
 * the provider in case a webhook was missed, and warn the owner a day before a hold runs out.
 */
export async function paymentsTickJob() {
  const now = Date.now();
  const stale = await systemDb
    .select({ id: paymentRequests.id, tenantId: paymentRequests.tenantId })
    .from(paymentRequests)
    .where(
      and(
        isNotNull(paymentRequests.providerCheckoutId),
        or(
          eq(paymentRequests.status, "held"),
          and(
            eq(paymentRequests.status, "open"),
            or(
              isNull(paymentRequests.lastCheckedAt),
              lt(paymentRequests.lastCheckedAt, new Date(now - RECHECK_MS)),
            ),
          ),
        ),
      ),
    )
    .limit(200);
  for (const row of stale) {
    await reconcilePayment(row.tenantId, row.id).catch((error: unknown) =>
      logger.warn({ err: error, paymentId: row.id }, "payment reconcile failed"),
    );
  }

  const ending = await systemDb
    .select({ id: paymentRequests.id, tenantId: paymentRequests.tenantId })
    .from(paymentRequests)
    .where(
      and(
        eq(paymentRequests.status, "held"),
        isNull(paymentRequests.holdWarnedAt),
        gt(paymentRequests.holdExpiresAt, new Date(now)),
        lt(paymentRequests.holdExpiresAt, new Date(now + 24 * 3600_000)),
      ),
    )
    .limit(200);
  for (const row of ending) await warnHoldEnding(row.tenantId, row.id);
}

async function warnHoldEnding(tenantId: string, paymentId: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [row] = await tx
      .update(paymentRequests)
      .set({ holdWarnedAt: new Date() })
      .where(
        and(
          eq(paymentRequests.id, paymentId),
          eq(paymentRequests.status, "held"),
          isNull(paymentRequests.holdWarnedAt),
        ),
      )
      .returning();
    if (!row?.holdExpiresAt) return;
    const party = await partyFor(tx, row.leadId);
    const when = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      timeZone: party.tenant.timezone,
    }).format(row.holdExpiresAt);
    await notifyOwner(tx, fx, {
      tenantId,
      kind: "payment",
      title: `The ${dollars(row.amountCents)} hold ends soon`,
      body: `${customerName(party.customer)}'s deposit hold for ${row.description} ends ${when}. Collect it before then, or it's released.`,
      leadId: row.leadId,
    });
  });
}

/* ── For the lead and customer pages ─────────────────────────────────────── */

export async function paymentsFor(tx: Tx, leadIds: string[]): Promise<PaymentItem[]> {
  if (leadIds.length === 0) return [];
  const rows = await tx
    .select()
    .from(paymentRequests)
    .where(inArray(paymentRequests.leadId, leadIds))
    .orderBy(desc(paymentRequests.createdAt));
  return rows.map(toPaymentItem);
}
