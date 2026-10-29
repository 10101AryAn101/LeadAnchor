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
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobPayloads {
  [QUEUES.extractCallerNeed]: { tenantId: string; leadId: string; callId: string | null; transcript: string; source: "voicemail" | "ai_dispatcher" | "web_form" };
  [QUEUES.triagePhoto]: { tenantId: string; mediaId: string };
  [QUEUES.dispatchMessage]: { tenantId: string; messageId: string };
  [QUEUES.valueProofTick]: Record<string, never>;
  [QUEUES.forwardingCheckTimeout]: { tenantId: string; startedAt: string };
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
  started = true;
}

export async function enqueue<Q extends QueueName>(name: Q, data: JobPayloads[Q], options: { startAfterSecs?: number } = {}) {
  return boss.send(name, data, options.startAfterSecs ? { startAfter: options.startAfterSecs } : {});
}

export async function stopQueue() {
  if (started) await boss.stop({ graceful: true, timeout: 10_000 });
}
