import { logger } from "../lib/logger";
import { extractCallerNeedJob, triagePhotoJob } from "../modules/ai/ai-jobs";
import { advanceRegistrationJob, registrationTickJob } from "../modules/compliance/registration.service";
import { dispatchMessage } from "../modules/messaging/dispatch";
import { paymentsTickJob } from "../modules/payments/payment.service";
import { forwardingCheckTimeoutJob } from "../modules/tenants/forwarding";
import { valueProofTickJob } from "../modules/value-proof/value-proof";
import { type JobPayloads, QUEUES, type QueueName, RETRY_LIMIT, boss } from "./queue";

type Handler<Q extends QueueName> = (data: JobPayloads[Q], attempt: { retryCount: number; isLast: boolean }) => Promise<void>;

async function work<Q extends QueueName>(name: Q, handler: Handler<Q>) {
  await boss.work<JobPayloads[Q]>(name, async (jobs) => {
    for (const job of jobs) {
      const started = Date.now();
      await handler(job.data, { retryCount: job.retryCount, isLast: job.retryCount >= RETRY_LIMIT });
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
}
