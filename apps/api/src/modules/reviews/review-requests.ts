import {
  type PublicFeedbackContext,
  type PublicUnsubscribe,
  type ReviewRequestOutcome,
  type privateFeedbackInput,
  reviewRequestMessage,
} from "@leadanchor/contracts";
import { and, eq, lt } from "drizzle-orm";
import type { z } from "zod";
import { env, linkBaseUrl } from "../../config/env";
import { systemDb } from "../../db/client";
import {
  customers,
  emailOptOuts,
  leads,
  listingConnections,
  reviewRequests,
  tenants,
} from "../../db/schema";
import { type Effects, tenantWork } from "../../db/unit-of-work";
import type { Tx } from "../../db/client";
import { QUEUES } from "../../jobs/queue";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../../lib/crypto";
import { HttpError, notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { audit } from "../compliance/audit";
import { addLeadEvent } from "../leads/lead-capture";
import { creditUnsubscribe } from "../campaigns/links";
import { isOptedOut, postalAddress, resolveUnsubscribeToken } from "../messaging/email-opt-out";
import { requestEmail } from "../messaging/send-path";
import { notifyOwner } from "../notifications/notify";
import { publicBusinessOf } from "../payments/payment.service";
import { reviewLinkOf } from "./listing.service";
import { firstNameOf } from "./reviews.service";

const DAY_MS = 86_400_000;
/** A request waiting on setup (the Google link, the postal address) gives up after this. */
const WAIT_DAYS = 14;

/** The customer's private line to the owner (C-46): today a message page, later the chat thread. */
export const feedbackUrl = (token: string) => `${linkBaseUrl}/f/${token}`;

const delaySecs = () => env.REVIEW_REQUEST_DELAY_MINUTES * 60;

/**
 * C-46: a job was marked Won, so its review request goes out after a short wait, to every
 * completed job alike. One per job, ever: marking it Won again doesn't send a second.
 */
export async function scheduleReviewRequest(
  tx: Tx,
  fx: Effects,
  input: { tenantId: string; leadId: string; customerId: string },
) {
  const sendAt = new Date(Date.now() + delaySecs() * 1000);
  const [existing] = await tx
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.leadId, input.leadId));
  if (existing && existing.outcome !== "canceled") return;
  let requestId = existing?.id;
  if (existing) {
    await tx
      .update(reviewRequests)
      .set({ outcome: "scheduled", detail: null, sendAt })
      .where(eq(reviewRequests.id, existing.id));
  } else {
    const token = randomToken();
    const [created] = await tx
      .insert(reviewRequests)
      .values({
        tenantId: input.tenantId,
        leadId: input.leadId,
        customerId: input.customerId,
        sendAt,
        tokenHash: sha256(token),
        tokenSealed: encryptSecret(token),
      })
      .returning({ id: reviewRequests.id });
    requestId = created!.id;
  }
  fx.enqueue(
    QUEUES.reviewRequestSend,
    { tenantId: input.tenantId, requestId: requestId! },
    { startAfterSecs: delaySecs() },
  );
  fx.publish({ type: "reviews.updated" });
}

/** The job left Won before its request went out (a mis-tap): it waits for the job to be Won again. */
export async function cancelReviewRequest(tx: Tx, leadId: string) {
  await tx
    .update(reviewRequests)
    .set({
      outcome: "canceled",
      detail: "The job was moved out of Won before the request went out.",
    })
    .where(and(eq(reviewRequests.leadId, leadId), eq(reviewRequests.outcome, "scheduled")));
}

const NOT_SENT: Partial<Record<ReviewRequestOutcome, string>> = {
  no_email:
    "No email address for this customer. Review requests go by email for now (texts need marketing consent).",
  unsubscribed: "They unsubscribed from these emails.",
  no_google_link: "Never sent: no Google link was added within two weeks.",
  no_address: "Never sent: no business address was added within two weeks.",
};

/** Sends one request if it's due. `now` sends it straight away (the simulator's "send now"). */
export async function sendReviewRequest(
  tenantId: string,
  requestId: string,
  options: { now?: boolean } = {},
) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [request] = await tx
      .select()
      .from(reviewRequests)
      .where(eq(reviewRequests.id, requestId))
      .for("update");
    if (!request || request.outcome !== "scheduled") return;
    if (!options.now && request.sendAt.getTime() > Date.now()) return;
    const [[lead], [tenant], [customer], [connection]] = await Promise.all([
      tx.select().from(leads).where(eq(leads.id, request.leadId)),
      tx.select().from(tenants).where(eq(tenants.id, tenantId)),
      tx.select().from(customers).where(eq(customers.id, request.customerId)),
      tx.select().from(listingConnections).limit(1),
    ]);
    if (!lead || !tenant || !customer) return;
    if (lead.stage !== "won") {
      await cancelReviewRequest(tx, lead.id);
      return;
    }

    const finish = async (outcome: ReviewRequestOutcome, extra: { messageId?: string } = {}) => {
      await tx
        .update(reviewRequests)
        .set({
          outcome,
          detail: NOT_SENT[outcome] ?? null,
          ...(outcome === "sent" && { sentAt: new Date(), messageId: extra.messageId }),
        })
        .where(eq(reviewRequests.id, request.id));
      await addLeadEvent(tx, {
        tenantId,
        leadId: lead.id,
        type: "review.requested",
        actor: "system",
        data: {
          requestId: request.id,
          outcome,
          channel: outcome === "sent" ? "email" : null,
          detail: NOT_SENT[outcome] ?? null,
        },
      });
      fx.publish({ type: "reviews.updated" });
      fx.publish({ type: "lead.updated", leadId: lead.id });
    };
    // Waiting on the owner's setup: it goes out as soon as that's done, or gives up after two weeks.
    const wait = async (outcome: "no_google_link" | "no_address", detail: string) => {
      if (Date.now() - request.createdAt.getTime() > WAIT_DAYS * DAY_MS) return finish(outcome);
      if (request.detail !== detail) {
        await tx.update(reviewRequests).set({ detail }).where(eq(reviewRequests.id, request.id));
        fx.publish({ type: "reviews.updated" });
      }
    };

    if (!customer.email) return finish("no_email");
    if (await isOptedOut(tx, customer.email)) return finish("unsubscribed");
    const googleLink = reviewLinkOf(tenant, connection);
    if (!googleLink)
      return wait(
        "no_google_link",
        "Waiting for your Google link: connect Google or add your listing link in Settings.",
      );
    if (!(await postalAddress(tx, tenant)))
      return wait(
        "no_address",
        "Waiting for your business address (street and ZIP) in Settings: US law requires it in these emails.",
      );

    const message = reviewRequestMessage({
      firstName: firstNameOf(customer.name),
      business: tenant.name,
      googleLink,
      privateLink: feedbackUrl(decryptSecret(request.tokenSealed)),
    });
    const sent = await requestEmail(tx, fx, {
      tenant,
      customerId: customer.id,
      leadId: lead.id,
      to: customer.email,
      subject: message.subject,
      body: message.body,
      purpose: "review_request",
    });
    if (sent.status === "blocked") {
      logger.warn(
        { tenantId, requestId, reason: sent.blockedReason },
        "review request email was blocked",
      );
      return finish(sent.blockedReason?.includes("unsubscribed") ? "unsubscribed" : "no_email");
    }
    await finish("sent", { messageId: sent.id });
  });
}

export const sendReviewRequestJob = (data: { tenantId: string; requestId: string }) =>
  sendReviewRequest(data.tenantId, data.requestId);

/** Every 15 minutes: requests waiting on setup try again; any that missed their send go now. */
export async function reviewRequestsTickJob() {
  const due = await systemDb
    .select({ id: reviewRequests.id, tenantId: reviewRequests.tenantId })
    .from(reviewRequests)
    .where(and(eq(reviewRequests.outcome, "scheduled"), lt(reviewRequests.sendAt, new Date())))
    .limit(200);
  for (const row of due) {
    await sendReviewRequest(row.tenantId, row.id).catch((error: unknown) =>
      logger.warn({ err: error, requestId: row.id }, "review request failed"),
    );
  }
}

/** The simulator's "send now": every waiting request of this business, without the wait. */
export async function sendWaitingRequestsNow(tenantId: string) {
  const waiting = await systemDb
    .select({ id: reviewRequests.id })
    .from(reviewRequests)
    .where(and(eq(reviewRequests.tenantId, tenantId), eq(reviewRequests.outcome, "scheduled")));
  for (const row of waiting) await sendReviewRequest(tenantId, row.id, { now: true });
  return { count: waiting.length };
}

/* ── The private line (C-46): the customer tells the owner directly ───────── */

async function resolveFeedback(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound("Link");
  const [row] = await systemDb
    .select({ request: reviewRequests, tenant: tenants, customer: customers })
    .from(reviewRequests)
    .innerJoin(tenants, eq(tenants.id, reviewRequests.tenantId))
    .innerJoin(customers, eq(customers.id, reviewRequests.customerId))
    .where(eq(reviewRequests.tokenHash, sha256(token)))
    .limit(1);
  if (!row || row.tenant.status === "cancelled" || row.tenant.status === "suspended")
    throw notFound("Link");
  return row;
}

export async function getFeedbackContext(token: string): Promise<PublicFeedbackContext> {
  const { request, tenant, customer } = await resolveFeedback(token);
  return {
    business: await publicBusinessOf(tenant),
    firstName: firstNameOf(customer.name),
    sent: Boolean(request.feedbackAt),
  };
}

const MESSAGES_PER_HOUR = 5;
const recentMessages = new Map<string, number[]>();

/** C-46 AC 5: a private message reaches the owner as a priority alert and a note on the job, at once. */
export async function submitFeedback(token: string, input: z.output<typeof privateFeedbackInput>) {
  const { request, tenant, customer } = await resolveFeedback(token);
  if (input.company) return { ok: true as const };
  const recent = (recentMessages.get(request.id) ?? []).filter((at) => Date.now() - at < 3_600_000);
  if (recent.length >= MESSAGES_PER_HOUR)
    throw new HttpError(429, "too_many_requests", `Please call ${tenant.name} instead.`);
  if (recentMessages.size > 10_000) recentMessages.clear();
  recentMessages.set(request.id, [...recent, Date.now()]);

  await tenantWork(tenant.id, async (tx, fx) => {
    await tx
      .update(reviewRequests)
      .set({ feedbackAt: new Date() })
      .where(eq(reviewRequests.id, request.id));
    await addLeadEvent(tx, {
      tenantId: tenant.id,
      leadId: request.leadId,
      type: "feedback.received",
      actor: "customer",
      data: { text: input.message },
    });
    await notifyOwner(tx, fx, {
      tenantId: tenant.id,
      kind: "feedback",
      title: `${customer.name ?? "A customer"} sent you a private message`,
      body:
        input.message.length > 140 ? `${input.message.slice(0, 139).trimEnd()}…` : input.message,
      leadId: request.leadId,
      callbackPhone: customer.phoneE164,
    });
    fx.publish({ type: "lead.updated", leadId: request.leadId });
  });
  return { ok: true as const };
}

/* ── Unsubscribe (CAN-SPAM) ──────────────────────────────────────────────── */

const masked = (email: string) => {
  const [user, domain] = email.split("@");
  return `${user!.charAt(0)}***@${domain}`;
};

async function resolveUnsubscribe(token: string) {
  const resolved = resolveUnsubscribeToken(token);
  if (!resolved) throw notFound("Link");
  const [tenant] = await systemDb
    .select()
    .from(tenants)
    .where(eq(tenants.id, resolved.tenantId))
    .limit(1);
  if (!tenant) throw notFound("Link");
  return { tenant, email: resolved.email };
}

export async function getUnsubscribe(token: string): Promise<PublicUnsubscribe> {
  const { tenant, email } = await resolveUnsubscribe(token);
  const [row] = await systemDb
    .select({ id: emailOptOuts.id })
    .from(emailOptOuts)
    .where(and(eq(emailOptOuts.tenantId, tenant.id), eq(emailOptOuts.email, email)))
    .limit(1);
  return { businessName: tenant.name, email: masked(email), unsubscribed: Boolean(row) };
}

/** One click, no login, no questions (CAN-SPAM). Honoured from the next email on. */
export async function unsubscribe(token: string): Promise<PublicUnsubscribe> {
  const { tenant, email } = await resolveUnsubscribe(token);
  await tenantWork(tenant.id, async (tx) => {
    const inserted = await tx
      .insert(emailOptOuts)
      .values({ tenantId: tenant.id, email, source: "unsubscribe_link" })
      .onConflictDoNothing()
      .returning({ id: emailOptOuts.id });
    if (inserted.length > 0) {
      await creditUnsubscribe(tx, email);
      await audit(tx, {
        tenantId: tenant.id,
        actor: "customer",
        action: "email.unsubscribed",
        entityType: "email",
        entityId: inserted[0]!.id,
      });
    }
  });
  return { businessName: tenant.name, email: masked(email), unsubscribed: true };
}
