import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { env, linkBaseUrl, operatorEmails } from "../../config/env";
import { channels } from "../../container";
import { systemDb } from "../../db/client";
import { systemAlerts, systemErrors } from "../../db/schema";
import { logger } from "../../lib/logger";

/**
 * Observability (spec §6): server errors are kept, and a health check every five minutes raises an
 * alert, emailed once to LeadAnchor staff, when jobs, webhooks, messages or the server start failing.
 * It clears itself once things are quiet again. Staff see both in the operator console (module 14).
 */

/** An unexpected server error (5xx): kept for the console and the health check. Never throws. */
export function recordServerError(input: { route: string; status: number; message: string; requestId: string | null; tenantId?: string | null }) {
  void systemDb
    .insert(systemErrors)
    .values({
      route: input.route.slice(0, 200),
      status: input.status,
      message: input.message.slice(0, 500),
      requestId: input.requestId,
      tenantId: input.tenantId ?? null,
    })
    .catch((error: unknown) => logger.warn({ err: error }, "server error not recorded"));
}

/** What the health check watches over the last 15 minutes, and how many failures make an alert. */
export const ALERT_RULES = [
  {
    kind: "jobs",
    threshold: 3,
    count: sql<number>`(select count(*)::int from pgboss.job where state = 'failed' and coalesce(completed_on, created_on) > now() - interval '15 minutes')`,
    message: (count: number) => `${count} background jobs failed in the last 15 minutes.`,
  },
  {
    kind: "webhooks",
    threshold: 3,
    count: sql<number>`(select count(*)::int from webhook_inbox where status = 'failed' and received_at > now() - interval '15 minutes')`,
    message: (count: number) => `${count} provider webhooks failed to apply in the last 15 minutes.`,
  },
  {
    kind: "messages",
    threshold: 5,
    count: sql<number>`(select count(*)::int from messages where direction = 'outbound' and status = 'failed' and created_at > now() - interval '15 minutes')`,
    message: (count: number) => `${count} messages to customers failed to send in the last 15 minutes.`,
  },
  {
    kind: "errors",
    threshold: 3,
    count: sql<number>`(select count(*)::int from system_errors where created_at > now() - interval '15 minutes')`,
    message: (count: number) => `${count} server errors in the last 15 minutes.`,
  },
] as const;

/** Staff alert emails go straight to the email channel: they're to LeadAnchor's team, not to customers. */
async function emailStaff(subject: string, body: string) {
  for (const to of operatorEmails) {
    await channels.email
      .send({ id: randomUUID(), from: env.EMAIL_FROM, to, subject, body })
      .catch((error: unknown) => logger.error({ err: error }, "alert email failed"));
  }
}

/** Job, every five minutes: raise an alert for each rule over its threshold; clear the ones that are quiet. */
export async function healthTickJob() {
  const raised: string[] = [];
  for (const rule of ALERT_RULES) {
    const [row] = (await systemDb.execute(sql`select ${rule.count} as count`).catch(() => ({ rows: [] }))).rows as Array<{ count: number }>;
    const count = Number(row?.count ?? 0);
    const [open] = await systemDb
      .select()
      .from(systemAlerts)
      .where(and(eq(systemAlerts.kind, rule.kind), isNull(systemAlerts.resolvedAt)))
      .limit(1);
    if (count >= rule.threshold) {
      if (open) continue;
      const message = rule.message(count);
      await systemDb.insert(systemAlerts).values({ kind: rule.kind, message, notifiedAt: operatorEmails.length > 0 ? new Date() : null });
      logger.error({ alert: rule.kind, count }, message);
      raised.push(message);
    } else if (open && count === 0) {
      await systemDb.update(systemAlerts).set({ resolvedAt: new Date() }).where(eq(systemAlerts.id, open.id));
    }
  }
  if (raised.length > 0) {
    await emailStaff(
      `LeadAnchor alert: ${raised.length === 1 ? raised[0] : `${raised.length} problems`}`,
      `${raised.join("\n")}\n\nDetails in the operator console: ${linkBaseUrl}/ops`,
    );
  }
  return { raised: raised.length };
}

/* ── Data retention (spec §6, "defined retention") ─────────────────────── */

/**
 * What is kept, and for how long. A business's own records (customers, jobs, messages, payments)
 * stay while it's a customer; identity numbers for carrier registration are deleted once approved
 * (C-43); a cancelled business's customer data can be erased by staff from the console.
 */
export const RETENTION_RULES = [
  { what: "Provider webhooks, applied or ignored", keepDays: 30 },
  { what: "Provider webhooks that failed", keepDays: 90 },
  { what: "Server errors", keepDays: 30 },
  { what: "Cleared health alerts", keepDays: 90 },
  { what: "Read owner notifications", keepDays: 180 },
] as const;

/** Job, daily: delete what's past its keep date. Returns how many rows each rule removed. */
export async function retentionTickJob() {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
  const counts = await Promise.all([
    systemDb.execute(sql`delete from webhook_inbox where status in ('processed', 'ignored') and received_at < ${daysAgo(30)}`),
    systemDb.execute(sql`delete from webhook_inbox where status in ('failed', 'received') and received_at < ${daysAgo(90)}`),
    systemDb.delete(systemErrors).where(lt(systemErrors.createdAt, daysAgo(30))),
    systemDb.execute(sql`delete from system_alerts where resolved_at < ${daysAgo(90)}`),
    systemDb.execute(sql`delete from notifications where read_at < ${daysAgo(180)}`),
  ]);
  const removed = counts.map((result) => (result as { rowCount?: number | null }).rowCount ?? 0);
  logger.info({ removed }, "retention: old records deleted");
  return { removed };
}
