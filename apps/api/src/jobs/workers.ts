import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logger } from "../lib/logger";
import { extractCallerNeedJob, triagePhotoJob } from "../modules/ai/ai-jobs";
import { advanceRegistrationJob, registrationTickJob } from "../modules/compliance/registration.service";
import { bookingsTickJob } from "../modules/booking/booking.service";
import { campaignSendJob } from "../modules/campaigns/send";
import { campaignSignalsTickJob } from "../modules/campaigns/signals";
import { assistantReplyJob } from "../modules/chat/assistant";
import { membershipsTickJob } from "../modules/memberships/membership.service";
import { calendarSyncTickJob, pushBookingJob } from "../modules/booking/calendar-sync";
import { dispatchMessage } from "../modules/messaging/dispatch";
import { networkTickJob } from "../modules/network/network.service";
import { discoveryTickJob } from "../modules/discovery/discovery.service";
import { healthTickJob, retentionTickJob } from "../modules/monitoring/monitoring.service";
import { paymentsTickJob } from "../modules/payments/payment.service";
import { listingPushJob, listingSyncJob, listingSyncTickJob } from "../modules/reviews/listing.service";
import { reviewRequestsTickJob, sendReviewRequestJob } from "../modules/reviews/review-requests";
import { draftReplyJob, postReplyJob } from "../modules/reviews/reviews.service";
import { forwardingCheckTimeoutJob } from "../modules/tenants/forwarding";
import { valueProofTickJob } from "../modules/value-proof/value-proof";
import { type JobPayloads, QUEUES, type QueueName, RETRY_LIMIT, boss } from "./queue";

type Handler<Q extends QueueName> = (data: JobPayloads[Q], attempt: { retryCount: number; isLast: boolean }) => Promise<void>;

/** Each job run is a trace span of its own (a no-op unless tracing is switched on, see instrument.ts). */
const tracer = trace.getTracer("leadanchor-jobs");

async function work<Q extends QueueName>(name: Q, handler: Handler<Q>) {
  await boss.work<JobPayloads[Q]>(name, async (jobs) => {
    for (const job of jobs) {
      const started = Date.now();
      await tracer.startActiveSpan(`job ${name}`, { attributes: { "job.queue": name, "job.id": job.id, "job.retry": job.retryCount } }, async (span) => {
        try {
          await handler(job.data, { retryCount: job.retryCount, isLast: job.retryCount >= RETRY_LIMIT });
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
          logger.warn({ queue: name, jobId: job.id, err: error }, "job failed");
          throw error;
        } finally {
          span.end();
        }
      });
      logger.debug({ queue: name, jobId: job.id, ms: Date.now() - started }, "job done");
    }
  });
}

export async function startWorkers() {
  await work(QUEUES.extractCallerNeed, extractCallerNeedJob);
  await work(QUEUES.triagePhoto, triagePhotoJob);
  await work(QUEUES.dispatchMessage, dispatchMessage);
  await work(QUEUES.valueProofTick, valueProofTickJob);
  await work(QUEUES.forwardingCheckTimeout, forwardingCheckTimeoutJob);
  await work(QUEUES.registrationAdvance, advanceRegistrationJob);
  await work(QUEUES.registrationTick, registrationTickJob);
  await work(QUEUES.paymentsTick, paymentsTickJob);
  await work(QUEUES.bookingsTick, bookingsTickJob);
  await work(QUEUES.calendarPush, pushBookingJob);
  await work(QUEUES.calendarSyncTick, calendarSyncTickJob);
  await work(QUEUES.listingSyncTick, listingSyncTickJob);
  await work(QUEUES.listingSync, listingSyncJob);
  await work(QUEUES.listingPush, listingPushJob);
  await work(QUEUES.reviewDraft, draftReplyJob);
  await work(QUEUES.reviewReplyPost, postReplyJob);
  await work(QUEUES.reviewRequestSend, sendReviewRequestJob);
  await work(QUEUES.reviewRequestsTick, reviewRequestsTickJob);
  await work(QUEUES.assistantReply, assistantReplyJob);
  await work(QUEUES.campaignSend, campaignSendJob);
  await work(QUEUES.campaignSignalsTick, campaignSignalsTickJob);
  await work(QUEUES.membershipsTick, membershipsTickJob);
  await work(QUEUES.networkTick, async () => {
    await networkTickJob();
  });
  await work(QUEUES.discoveryTick, discoveryTickJob);
  await work(QUEUES.healthTick, async () => {
    await healthTickJob();
  });
  await work(QUEUES.retentionTick, async () => {
    await retentionTickJob();
  });
}
