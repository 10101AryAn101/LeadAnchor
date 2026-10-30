import {
  LOW_RATING_MAX,
  type ReplyTone,
  type ReviewItem,
  type ReviewsResponse,
  type ReviewsSummary,
  formatPhone,
  replyLint,
} from "@leadanchor/contracts";
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, ne } from "drizzle-orm";
import { ai, listingProviders } from "../../container";
import { type Tx, systemDb, withTenant } from "../../db/client";
import {
  customers,
  leads,
  listingConnections,
  phoneNumbers,
  reviewRequests,
  reviews,
  tenants,
} from "../../db/schema";
import { type Effects, tenantWork } from "../../db/unit-of-work";
import type { ExternalReview } from "../../integrations/listings/types";
import { QUEUES, enqueue } from "../../jobs/queue";
import { HttpError, notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { iso } from "../../lib/time";
import { audit } from "../compliance/audit";
import { addLeadEvent } from "../leads/lead-capture";
import { postalAddress } from "../messaging/email-opt-out";
import { notifyOwner } from "../notifications/notify";
import { listingStatusOf, reviewLinkOf } from "./listing.service";

type ReviewRow = typeof reviews.$inferSelect;
type Tenant = typeof tenants.$inferSelect;

const DAY_MS = 86_400_000;

const excerpt = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const normalize = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
export const firstNameOf = (name: string | null | undefined) => {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : null;
};

/** "Maria Lopez" or "Maria L." both match the customer Maria Lopez. */
export const namesMatch = (reviewer: string, customer: string) =>
  sameName(normalize(reviewer), normalize(customer));

function sameName(review: string[], customer: string[]) {
  if (review.length === 0 || customer.length === 0) return false;
  if (review.join(" ") === customer.join(" ")) return true;
  return (
    review.length === 2 &&
    customer.length >= 2 &&
    review[0] === customer[0] &&
    review[1]!.length === 1 &&
    customer.at(-1)!.startsWith(review[1]!)
  );
}

/**
 * The completed job a review is about (C-47 AC 4): a customer with this name and a job marked Won
 * in the four months before it. Only one clear match counts; otherwise the review stays unlinked.
 */
async function matchReviewer(tx: Tx, reviewer: string, publishedAt: Date) {
  const wanted = normalize(reviewer);
  const rows = await tx
    .select({ leadId: leads.id, customerId: customers.id, name: customers.name })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .where(
      and(
        eq(leads.stage, "won"),
        isNotNull(customers.name),
        gt(leads.wonAt, new Date(publishedAt.getTime() - 120 * DAY_MS)),
      ),
    )
    .orderBy(desc(leads.wonAt));
  const matches = rows.filter((row) => sameName(wanted, normalize(row.name!)));
  return new Set(matches.map((row) => row.customerId)).size === 1 ? matches[0]! : null;
}

/** Brings the listing's reviews into LeadAnchor; called on every sync (C-21). */
export async function ingestReviews(
  tx: Tx,
  fx: Effects,
  input: { tenantId: string; external: ExternalReview[] },
) {
  const existing = await tx.select().from(reviews);
  const known = new Map(existing.map((row) => [row.externalId, row]));
  for (const review of input.external) {
    const row = known.get(review.id);
    if (row) {
      const patch: Partial<ReviewRow> = {};
      // Edited on Google by the reviewer.
      if (row.rating !== review.rating || row.text !== review.text)
        Object.assign(patch, { rating: review.rating, text: review.text });
      // Answered on Google directly, outside LeadAnchor.
      if (review.reply && row.replyStatus !== "posting" && review.reply.text !== row.replyText) {
        Object.assign(patch, {
          replyText: review.reply.text,
          replyPostedAt: review.reply.updatedAt,
          replyStatus: "posted",
          replyError: null,
          draftText: null,
        });
      }
      if (Object.keys(patch).length > 0)
        await tx.update(reviews).set(patch).where(eq(reviews.id, row.id));
      continue;
    }

    const match = await matchReviewer(tx, review.reviewer, review.publishedAt);
    const [created] = await tx
      .insert(reviews)
      .values({
        tenantId: input.tenantId,
        externalId: review.id,
        reviewerName: review.reviewer,
        rating: review.rating,
        text: review.text,
        publishedAt: review.publishedAt,
        replyText: review.reply?.text ?? null,
        replyPostedAt: review.reply?.updatedAt ?? null,
        replyStatus: review.reply ? "posted" : "needs_reply",
        customerId: match?.customerId ?? null,
        leadId: match?.leadId ?? null,
      })
      .returning();
    if (!review.reply)
      fx.enqueue(QUEUES.reviewDraft, { tenantId: input.tenantId, reviewId: created!.id });
    if (match) {
      await addLeadEvent(tx, {
        tenantId: input.tenantId,
        leadId: match.leadId,
        type: "review.left",
        actor: "customer",
        data: {
          reviewId: created!.id,
          rating: review.rating,
          text: review.text ? excerpt(review.text, 280) : null,
        },
      });
    }
    const low = review.rating <= LOW_RATING_MAX;
    await notifyOwner(tx, fx, {
      tenantId: input.tenantId,
      kind: "review",
      title: low
        ? `${review.rating}-star Google review: reply soon`
        : `New ${review.rating}-star Google review`,
      body: `${review.text ? `${review.reviewer} wrote “${excerpt(review.text, 120)}”` : `${review.reviewer} left a rating.`} A reply is drafted for you to check.`,
      leadId: match?.leadId ?? null,
      path: "/reviews",
    });
  }

  // Gone from Google (removed by the reviewer or by Google): no longer public, so it goes here too.
  const current = new Set(input.external.map((review) => review.id));
  const gone = existing.filter((row) => !current.has(row.externalId)).map((row) => row.id);
  if (gone.length > 0) await tx.delete(reviews).where(inArray(reviews.id, gone));
}

/* ── Reply drafts (C-47) ─────────────────────────────────────────────────── */

const monthOf = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone }).format(date);

/** A plain reply for when the AI isn't available. Same rules: no offers, nothing invented. */
export function templateReply(input: {
  tone: ReplyTone;
  rating: number;
  firstName: string | null;
  business: string;
  owner: string | null;
  service: string | null;
  phone: string | null;
}) {
  const name = input.firstName ? `, ${input.firstName}` : "";
  const sign = input.owner ? `– ${input.owner}, ${input.business}` : `– The ${input.business} team`;
  if (input.rating <= LOW_RATING_MAX) {
    const call = input.phone
      ? ` Please call us at ${input.phone} so we can talk it through.`
      : " Please get in touch so we can talk it through.";
    if (input.tone === "brief")
      return `Thank you for the feedback${name}. We're sorry it fell short.${call}\n${sign}`;
    return `Thank you for telling us about this${name}. We're sorry your experience fell short, and we'd like to understand what happened.${call}\n${sign}`;
  }
  const work = input.service ? ` with your ${input.service.toLowerCase()}` : "";
  if (input.tone === "brief") return `Thank you${name}! Glad we could help${work}.\n${sign}`;
  if (input.tone === "professional")
    return `Thank you for your review${name}. We're glad we could help${work}, and we appreciate you choosing ${input.business}.\n${sign}`;
  return `Thank you so much${name}! It was a pleasure helping you${work}. We really appreciate you choosing ${input.business}.\n${sign}`;
}

/** A background draft can wait out a busy model; one the owner asked for answers within seconds. */
async function draftFor(tenantId: string, reviewId: string, timeoutMs: number) {
  const context = await withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(reviews).where(eq(reviews.id, reviewId));
    if (!row) return null;
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [lead] = row.leadId ? await tx.select().from(leads).where(eq(leads.id, row.leadId)) : [];
    const [number] = await tx
      .select({ e164: phoneNumbers.e164 })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.status, "active"))
      .limit(1);
    return { row, tenant: tenant!, lead, phone: number ? formatPhone(number.e164) : null };
  });
  if (!context) return null;
  const { row, tenant, lead, phone } = context;
  const service = lead ? (lead.serviceCategory ?? lead.title) : null;
  const firstName = firstNameOf(row.reviewerName);
  const owner = firstNameOf(tenant.ownerName);
  if (ai.configured) {
    try {
      const { reply } = await ai.draftReviewReply({
        businessName: tenant.name,
        ownerFirstName: owner,
        tone: tenant.reviewReplyTone,
        review: { reviewerFirstName: firstName, rating: row.rating, text: row.text },
        job:
          lead && service
            ? { service, month: monthOf(lead.wonAt ?? lead.updatedAt, tenant.timezone) }
            : null,
        contactPhone: phone,
        timeoutMs,
      });
      // A draft that offers anything in return is never shown (C-47 AC 2).
      if (replyLint(reply).length === 0) return { row, draft: reply };
      logger.warn({ tenantId, reviewId }, "AI reply draft offered something; using the template");
    } catch (error) {
      logger.warn({ err: error, tenantId, reviewId }, "review reply draft fell back to a template");
    }
  }
  return {
    row,
    draft: templateReply({
      tone: tenant.reviewReplyTone,
      rating: row.rating,
      firstName,
      business: tenant.name,
      owner,
      service,
      phone,
    }),
  };
}

export async function draftReplyJob(data: { tenantId: string; reviewId: string }) {
  const result = await draftFor(data.tenantId, data.reviewId, 45_000);
  if (!result || result.row.replyStatus === "posted" || result.row.replyStatus === "posting")
    return;
  await tenantWork(data.tenantId, async (tx, fx) => {
    await tx
      .update(reviews)
      .set({ draftText: result.draft, replyStatus: "draft" })
      .where(
        and(eq(reviews.id, data.reviewId), inArray(reviews.replyStatus, ["needs_reply", "draft"])),
      );
    fx.publish({ type: "reviews.updated" });
  });
}

/** "Write it again": a fresh draft, e.g. after changing the tone. */
export async function redraftReply(tenantId: string, reviewId: string): Promise<ReviewItem> {
  const result = await draftFor(tenantId, reviewId, 15_000);
  if (!result) throw notFound("Review");
  if (result.row.replyStatus === "posting")
    throw new HttpError(409, "posting", "That reply is being posted.");
  await tenantWork(tenantId, async (tx, fx) => {
    await tx
      .update(reviews)
      .set({
        draftText: result.draft,
        ...(result.row.replyStatus !== "posted" && { replyStatus: "draft" as const }),
      })
      .where(eq(reviews.id, reviewId));
    fx.publish({ type: "reviews.updated" });
  });
  return reviewItem(tenantId, reviewId);
}

/* ── Approval and posting ────────────────────────────────────────────────── */

/** The owner approves a reply (C-47 AC 1: nothing posts without this). It's posted in the background. */
export async function approveReply(
  tenantId: string,
  userId: string,
  reviewId: string,
  text: string,
): Promise<ReviewItem> {
  const problems = replyLint(text);
  if (problems.length > 0) {
    throw new HttpError(
      422,
      "validation_failed",
      `Replies can't offer anything in return, so take out ${problems[0]!.match(/“[^”]+”/)?.[0] ?? "the offer"}.`,
      { text: problems },
    );
  }
  await tenantWork(tenantId, async (tx, fx) => {
    const [row] = await tx.select().from(reviews).where(eq(reviews.id, reviewId)).for("update");
    if (!row) throw notFound("Review");
    if (row.replyStatus === "posting")
      throw new HttpError(409, "posting", "That reply is already being posted.");
    await tx
      .update(reviews)
      .set({
        draftText: text,
        replyStatus: "posting",
        replyError: null,
        replyApprovedBy: `user:${userId}`,
      })
      .where(eq(reviews.id, reviewId));
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "review.reply_approved",
      entityType: "review",
      entityId: reviewId,
    });
    fx.enqueue(QUEUES.reviewReplyPost, { tenantId, reviewId });
    fx.publish({ type: "reviews.updated" });
  });
  return reviewItem(tenantId, reviewId);
}

/** Posts an approved reply. A refusal is retried; the last one is shown to the owner (C-47 AC 6). */
export async function postReplyJob(
  data: { tenantId: string; reviewId: string },
  attempt: { isLast: boolean },
) {
  const loaded = await withTenant(data.tenantId, async (tx) => {
    const [row] = await tx.select().from(reviews).where(eq(reviews.id, data.reviewId));
    const [connection] = await tx.select().from(listingConnections).limit(1);
    return { row, connection };
  });
  const { row, connection } = loaded;
  if (!row || row.replyStatus !== "posting" || !row.draftText) return;
  const adapter = connection ? listingProviders[connection.provider] : undefined;

  try {
    if (!connection || !adapter) throw new Error("Google isn't connected any more.");
    await adapter.reply(connection.account, row.externalId, row.draftText);
  } catch (error) {
    const message = (error as Error).message;
    const final = attempt.isLast || !connection;
    await tenantWork(data.tenantId, async (tx, fx) => {
      await tx
        .update(reviews)
        .set(
          final
            ? { replyStatus: "failed", replyError: message }
            : { replyError: `${message} Trying again shortly.` },
        )
        .where(eq(reviews.id, row.id));
      if (final) {
        await notifyOwner(tx, fx, {
          tenantId: data.tenantId,
          kind: "review",
          title: "A review reply didn't post",
          body: `Your reply to ${row.reviewerName} didn't go through: ${message} Open Reviews to try again.`,
          path: "/reviews",
        });
      }
      fx.publish({ type: "reviews.updated" });
    });
    if (!final) throw error;
    return;
  }

  await tenantWork(data.tenantId, async (tx, fx) => {
    await tx
      .update(reviews)
      .set({
        replyText: row.draftText,
        replyPostedAt: new Date(),
        replyStatus: "posted",
        replyError: null,
        draftText: null,
      })
      .where(eq(reviews.id, row.id));
    if (row.leadId) {
      await addLeadEvent(tx, {
        tenantId: data.tenantId,
        leadId: row.leadId,
        type: "review.replied",
        actor: row.replyApprovedBy ?? "system",
        data: { reviewId: row.id, text: excerpt(row.draftText!, 280) },
      });
    }
    fx.publish({ type: "reviews.updated" });
  });
}

/** C-23: the owner picks which positive reviews appear on their profile page. */
export async function setShowOnProfile(
  tenantId: string,
  userId: string,
  reviewId: string,
  show: boolean,
): Promise<ReviewItem> {
  await tenantWork(tenantId, async (tx, fx) => {
    const [row] = await tx.select().from(reviews).where(eq(reviews.id, reviewId));
    if (!row) throw notFound("Review");
    if (show && (row.rating < 4 || !row.text)) {
      throw new HttpError(
        422,
        "validation_failed",
        "Only 4- and 5-star reviews with words can go on your profile.",
      );
    }
    await tx.update(reviews).set({ showOnProfile: show }).where(eq(reviews.id, reviewId));
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: show ? "review.shown" : "review.hidden",
      entityType: "review",
      entityId: reviewId,
    });
    fx.publish({ type: "reviews.updated" });
  });
  return reviewItem(tenantId, reviewId);
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

function toReviewItem(row: ReviewRow, job: { leadId: string; title: string } | null): ReviewItem {
  return {
    id: row.id,
    reviewer: row.reviewerName,
    rating: row.rating,
    text: row.text,
    publishedAt: row.publishedAt.toISOString(),
    reply:
      row.replyText && row.replyPostedAt
        ? { text: row.replyText, postedAt: row.replyPostedAt.toISOString() }
        : null,
    draft: row.draftText,
    replyStatus: row.replyStatus,
    replyError: row.replyError,
    showOnProfile: row.showOnProfile,
    job,
  };
}

async function reviewItem(tenantId: string, reviewId: string): Promise<ReviewItem> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ review: reviews, title: leads.title })
      .from(reviews)
      .leftJoin(leads, eq(leads.id, reviews.leadId))
      .where(eq(reviews.id, reviewId));
    if (!row) throw notFound("Review");
    return toReviewItem(
      row.review,
      row.review.leadId && row.title ? { leadId: row.review.leadId, title: row.title } : null,
    );
  });
}

const NEEDS_REPLY = ["needs_reply", "draft", "failed"] as const;

async function stats(tx: Tx) {
  const [connection] = await tx.select().from(listingConnections).limit(1);
  const [[waiting], [fresh]] = await Promise.all([
    tx
      .select({ n: count() })
      .from(reviews)
      .where(inArray(reviews.replyStatus, [...NEEDS_REPLY])),
    tx
      .select({ n: count() })
      .from(reviews)
      .where(gt(reviews.publishedAt, new Date(Date.now() - 7 * DAY_MS))),
  ]);
  return {
    connection,
    stats: {
      average: connection?.rating ?? null,
      count: connection?.reviewCount ?? 0,
      needReply: waiting?.n ?? 0,
      newThisWeek: fresh?.n ?? 0,
    },
  };
}

export async function getReviewsSummary(tenantId: string): Promise<ReviewsSummary> {
  return withTenant(tenantId, async (tx) => {
    const { connection, stats: numbers } = await stats(tx);
    return {
      connected: Boolean(connection),
      rating: numbers.average,
      count: numbers.count,
      needReply: numbers.needReply,
      newThisWeek: numbers.newThisWeek,
    };
  });
}

export async function getReviews(tenantId: string): Promise<ReviewsResponse> {
  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const { connection, stats: numbers } = await stats(tx);
    const rows = await tx
      .select({ review: reviews, title: leads.title })
      .from(reviews)
      .leftJoin(leads, eq(leads.id, reviews.leadId))
      .orderBy(desc(reviews.publishedAt))
      .limit(100);
    return {
      listing: listingStatusOf(connection),
      reviews: rows.map(({ review, title }) =>
        toReviewItem(review, review.leadId && title ? { leadId: review.leadId, title } : null),
      ),
      stats: numbers,
      requests: await requestAudit(tx),
      reviewLink: reviewLinkOf(tenant!, connection),
      postalAddress: await postalAddress(tx, tenant!),
    };
  });
}

/**
 * C-46 AC 7: proof that every completed job was asked. Counts jobs marked Won since review
 * requests started (the first one), and the requests made for them.
 */
async function requestAudit(tx: Tx): Promise<ReviewsResponse["requests"]> {
  const [first] = await tx
    .select({ at: reviewRequests.createdAt })
    .from(reviewRequests)
    .orderBy(asc(reviewRequests.createdAt))
    .limit(1);
  const since = new Date(Math.max(first?.at.getTime() ?? Date.now(), Date.now() - 90 * DAY_MS));
  const [[completed], [requested], [sent], recent] = await Promise.all([
    tx
      .select({ n: count() })
      .from(leads)
      .where(and(eq(leads.stage, "won"), gte(leads.wonAt, since))),
    tx
      .select({ n: count() })
      .from(reviewRequests)
      .innerJoin(leads, eq(leads.id, reviewRequests.leadId))
      .where(
        and(
          ne(reviewRequests.outcome, "canceled"),
          eq(leads.stage, "won"),
          gte(leads.wonAt, since),
        ),
      ),
    tx
      .select({ n: count() })
      .from(reviewRequests)
      .where(and(eq(reviewRequests.outcome, "sent"), gte(reviewRequests.createdAt, since))),
    tx
      .select({ request: reviewRequests, title: leads.title, name: customers.name })
      .from(reviewRequests)
      .innerJoin(leads, eq(leads.id, reviewRequests.leadId))
      .innerJoin(customers, eq(customers.id, reviewRequests.customerId))
      .orderBy(desc(reviewRequests.createdAt))
      .limit(20),
  ]);
  return {
    completedJobs: first ? (completed?.n ?? 0) : 0,
    requested: requested?.n ?? 0,
    sent: sent?.n ?? 0,
    recent: recent.map(({ request, title, name }) => ({
      id: request.id,
      leadId: request.leadId,
      customerName: name,
      jobTitle: title,
      outcome: request.outcome,
      detail: request.detail,
      sendAt: request.sendAt.toISOString(),
      feedbackAt: iso(request.feedbackAt),
    })),
  };
}

/* ── The public profile (C-23, C-41) ─────────────────────────────────────── */

/** "Maria L.": enough to be real, not a full name on a public page. */
const shortName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : (first ?? "A customer");
};

/**
 * The rating and the reviews the owner chose for the profile page. Only while Google is connected,
 * so what shows is still public there; a stale rating is refreshed in the background (C-41 AC 2).
 */
export async function profileReviews(tenant: Tenant) {
  const [connection] = await systemDb
    .select()
    .from(listingConnections)
    .where(eq(listingConnections.tenantId, tenant.id))
    .limit(1);
  if (!connection) return { rating: null, reviews: [] };
  if (!connection.lastSyncedAt || Date.now() - connection.lastSyncedAt.getTime() > 30 * 60_000) {
    void enqueue(QUEUES.listingSync, { tenantId: tenant.id }).catch((error: unknown) =>
      logger.warn({ err: error }, "listing sync enqueue failed"),
    );
  }
  const shown = await systemDb
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.tenantId, tenant.id),
        eq(reviews.showOnProfile, true),
        gte(reviews.rating, 4),
        isNotNull(reviews.text),
      ),
    )
    .orderBy(desc(reviews.publishedAt))
    .limit(6);
  return {
    rating:
      connection.rating !== null && connection.reviewCount > 0
        ? { average: connection.rating, count: connection.reviewCount, url: connection.listingUrl }
        : null,
    reviews: shown.map((row) => ({
      reviewer: shortName(row.reviewerName),
      rating: row.rating,
      text: row.text!,
      publishedAt: row.publishedAt.toISOString(),
    })),
  };
}
