import { type JobPayloads, type QueueName, enqueue } from "../jobs/queue";
import { logger } from "../lib/logger";
import { type RealtimeEvent, realtime } from "../lib/realtime";
import { type Tx, withTenant } from "./client";

/**
 * Side effects that must only happen once the transaction has committed:
 * realtime pushes to the owner's screen and background jobs.
 */
export interface Effects {
  publish(event: RealtimeEvent): void;
  enqueue<Q extends QueueName>(name: Q, data: JobPayloads[Q], options?: { startAfterSecs?: number }): void;
  afterCommit(fn: () => Promise<void> | void): void;
}

/** Tenant-scoped transaction (row-level security on) plus post-commit effects. */
export async function tenantWork<T>(tenantId: string, fn: (tx: Tx, fx: Effects) => Promise<T>): Promise<T> {
  const pending: Array<() => Promise<unknown> | unknown> = [];
  const fx: Effects = {
    publish: (event) => pending.push(() => realtime.publish(tenantId, event)),
    enqueue: (name, data, options) => pending.push(() => enqueue(name, data, options)),
    afterCommit: (fn) => pending.push(fn),
  };

  const result = await withTenant(tenantId, (tx) => fn(tx, fx));

  for (const effect of pending) {
    try {
      await effect();
    } catch (error) {
      logger.error({ err: error, tenantId }, "post-commit effect failed");
    }
  }
  return result;
}
