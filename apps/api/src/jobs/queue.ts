import { PgBoss } from "pg-boss";
import { env } from "../config/env";
import { logger } from "../lib/logger";

/** Background job queues (pg-boss on PostgreSQL — no extra infrastructure). */
export const QUEUES = {
  /** Gemini: turn a call transcript into lead details (C-13, C-39). */
  extractCallerNeed: "ai.extract-caller-need",
  /** Gemini vision: tag a customer photo (C-09). */
  triagePhoto: "ai.triage-photo",
  /** Deliver one outbound message through its channel adapter (Module 5). */
  dispatchMessage: "messaging.dispatch",
  /** Every 15 minutes: send value-proof summaries that are due (C-40). */
  valueProofTick: "value-proof.tick",
  /** Closes a forwarding test that never came back (C-01). */
  forwardingCheckTimeout: "forwarding.check-timeout",
  /** Moves one business's carrier registration a step forward (C-43). */
  registrationAdvance: "registration.advance",
  /** Every 15 minutes: re-check registrations under review and delete expired IDs (C-43). */
  registrationTick: "registration.tick",
  /** Every 15 minutes: re-check open checkouts and card holds, and warn before a hold ends (module 7). */
  paymentsTick: "payments.tick",
  /** Every 15 minutes: day-before booking reminders (C-20) and expired waitlist offers (C-22). */
  bookingsTick: "bookings.tick",
  /** Writes one booking into the owner's calendar, or takes it out (module 8). */
  calendarPush: "calendar.push",
  /** Every 5 minutes: read what changed in connected calendars (module 8). */
  calendarSyncTick: "calendar.sync-tick",
  /** Every 15 minutes: read every connected Google listing: rating and new reviews (C-21). */
  listingSyncTick: "listing.sync-tick",
  /** Reads one business's listing now (after connecting, or when the profile's rating is stale). */
  listingSync: "listing.sync",
  /** Writes the business's hours, phone, website, booking link and address to its listing (C-21). */
  listingPush: "listing.push",
  /** The AI's first draft of a reply to a new Google review (C-47). */
  reviewDraft: "reviews.draft",
  /** Posts a reply the owner approved; retries, then tells the owner if it can't (C-47 AC 6). */
  reviewReplyPost: "reviews.reply-post",
  /** Sends one completed job's review request, after the short wait (C-46). */
  reviewRequestSend: "reviews.request-send",
  /** Every 15 minutes: review requests that were waiting on setup try again (C-46). */
  reviewRequestsTick: "reviews.requests-tick",
  /** The chat assistant answers a customer's latest message (C-11, C-16). */
  assistantReply: "chat.assistant-reply",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobPayloads {
  [QUEUES.extractCallerNeed]: { tenantId: string; leadId: string; callId: string | null; transcript: string; source: "voicemail" | "ai_dispatcher" | "web_form" };
  [QUEUES.triagePhoto]: { tenantId: string; mediaId: string };
  [QUEUES.dispatchMessage]: { tenantId: string; messageId: string };
  [QUEUES.valueProofTick]: Record<string, never>;
  [QUEUES.forwardingCheckTimeout]: { tenantId: string; startedAt: string };
  [QUEUES.registrationAdvance]: { tenantId: string };
  [QUEUES.registrationTick]: Record<string, never>;
  [QUEUES.paymentsTick]: Record<string, never>;
  [QUEUES.bookingsTick]: Record<string, never>;
  [QUEUES.calendarPush]: { tenantId: string; bookingId: string };
  [QUEUES.calendarSyncTick]: Record<string, never>;
  [QUEUES.listingSyncTick]: Record<string, never>;
  [QUEUES.listingSync]: { tenantId: string };
  [QUEUES.listingPush]: { tenantId: string };
  [QUEUES.reviewDraft]: { tenantId: string; reviewId: string };
  [QUEUES.reviewReplyPost]: { tenantId: string; reviewId: string };
  [QUEUES.reviewRequestSend]: { tenantId: string; requestId: string };
  [QUEUES.reviewRequestsTick]: Record<string, never>;
  [QUEUES.assistantReply]: { tenantId: string; conversationId: string };
}

export const boss = new PgBoss({ connectionString: env.DATABASE_SYSTEM_URL, schema: "pgboss" });
boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));

/** AI providers have demand spikes (Gemini returns 503); retries spread over several minutes. */
export const RETRY_LIMIT = 5;
const RETRY_POLICY = { retryLimit: RETRY_LIMIT, retryDelay: 15, retryBackoff: true, retryDelayMax: 300 };

let started = false;

export async function startQueue() {
  if (started) return;
  await boss.start();
  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name, RETRY_POLICY);
    await boss.updateQueue(name, RETRY_POLICY);
  }
  await boss.schedule(QUEUES.valueProofTick, "*/15 * * * *");
  await boss.schedule(QUEUES.registrationTick, "*/15 * * * *");
  await boss.schedule(QUEUES.paymentsTick, "*/15 * * * *");
  await boss.schedule(QUEUES.bookingsTick, "*/15 * * * *");
  await boss.schedule(QUEUES.calendarSyncTick, "*/5 * * * *");
  await boss.schedule(QUEUES.listingSyncTick, "*/15 * * * *");
  await boss.schedule(QUEUES.reviewRequestsTick, "*/15 * * * *");
  started = true;
}

export async function enqueue<Q extends QueueName>(name: Q, data: JobPayloads[Q], options: { startAfterSecs?: number } = {}) {
  return boss.send(name, data, options.startAfterSecs ? { startAfter: options.startAfterSecs } : {});
}

export async function stopQueue() {
  if (started) await boss.stop({ graceful: true, timeout: 10_000 });
}
