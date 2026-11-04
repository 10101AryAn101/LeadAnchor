import {
  ACCOUNT_STATUSES,
  type AccountStatus,
  type OpsHealth,
  type OpsOverview,
  type OpsTenantDetail,
  type OpsTenantRow,
  type Tier,
  type Trade,
  accessTier,
} from "@leadanchor/contracts";
import { type SQL, eq, sql } from "drizzle-orm";
import { systemDb } from "../../db/client";
import { storage } from "../../container";
import { calls, conversations, customers, handoffOffers, mediaAssets, messages, networkMembers, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { HttpError, notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { RETENTION_RULES } from "../monitoring/monitoring.service";
import { profileUrl } from "../profile/links";
import { audit } from "../compliance/audit";

/**
 * Module 14: what LeadAnchor staff see across every business. Reads go straight to the database
 * (no row-level security: staff work across tenants); every change is written to the business's
 * own audit trail with the operator's email.
 */

const rows = async <T>(query: SQL) => (await systemDb.execute(query)).rows as T[];
const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);

interface TenantRowSql {
  id: string;
  name: string;
  slug: string;
  trade: Trade;
  city: string | null;
  state: string | null;
  status: AccountStatus;
  tier: Tier | null;
  trial_ends_at: Date | null;
  is_demo: boolean;
  created_at: Date;
  owner_email: string | null;
  leads30d: number;
}

const TENANT_ROW = sql`select t.id, t.name, t.slug, t.trade, t.city, t.state, t.status, t.tier, t.trial_ends_at, t.is_demo, t.created_at,
    (select u.email from memberships m join "user" u on u.id = m.user_id where m.tenant_id = t.id and m.role = 'owner' limit 1) as owner_email,
    (select count(*) from leads l where l.tenant_id = t.id and l.created_at > now() - interval '30 days')::int as leads30d
  from tenants t`;

function rowOf(row: TenantRowSql): OpsTenantRow {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    trade: row.trade,
    place: [row.city, row.state].filter(Boolean).join(", ") || null,
    ownerEmail: row.owner_email,
    status: row.status,
    // What they can use right now (a trial gets everything; see accessTier).
    tier: accessTier({ status: row.status, tier: row.tier, trialEndsAt: row.trial_ends_at, isDemo: row.is_demo }),
    trialEndsAt: iso(row.trial_ends_at),
    createdAt: iso(row.created_at)!,
    leads30d: row.leads30d,
  };
}

/** Monitoring: what failed in the last day, and the alerts still open. */
export async function health(): Promise<OpsHealth> {
  const [failedJobs, failedWebhooks, [messages], errors, alerts] = await Promise.all([
    rows<{ queue: string; count: number; last_error: string | null; last_at: Date }>(
      sql`select name as queue, count(*)::int as count, max(coalesce(completed_on, created_on)) as last_at,
          left((array_agg(output::text order by coalesce(completed_on, created_on) desc))[1], 300) as last_error
        from pgboss.job where state = 'failed' and created_on > now() - interval '24 hours'
        group by name order by count desc`,
    ).catch(() => []),
    rows<{ provider: string; count: number; last_error: string | null }>(
      sql`select provider, count(*)::int as count, left((array_agg(error order by received_at desc))[1], 300) as last_error
        from webhook_inbox where status = 'failed' and received_at > now() - interval '24 hours'
        group by provider order by count desc`,
    ),
    rows<{ failed: number; blocked: number; sent: number }>(
      sql`select count(*) filter (where status = 'failed')::int as failed,
          count(*) filter (where status = 'blocked')::int as blocked,
          count(*) filter (where status in ('sent', 'delivered'))::int as sent
        from messages where direction = 'outbound' and created_at > now() - interval '24 hours'`,
    ),
    rows<{ created_at: Date; route: string; message: string; request_id: string | null }>(
      sql`select created_at, route, message, request_id from system_errors
        where created_at > now() - interval '24 hours' order by created_at desc limit 20`,
    ),
    rows<{ id: string; kind: string; message: string; raised_at: Date }>(
      sql`select id, kind, message, raised_at from system_alerts where resolved_at is null order by raised_at desc limit 20`,
    ),
  ]);
  return {
    failedJobs: failedJobs.map((job) => ({ queue: job.queue, count: job.count, lastError: job.last_error, lastAt: iso(job.last_at)! })),
    failedWebhooks: failedWebhooks.map((hook) => ({ provider: hook.provider, count: hook.count, lastError: hook.last_error })),
    messages: { failed: messages?.failed ?? 0, blocked: messages?.blocked ?? 0, sent: messages?.sent ?? 0 },
    errors: errors.map((error) => ({ at: iso(error.created_at)!, route: error.route, message: error.message, requestId: error.request_id })),
    alerts: alerts.map((alert) => ({ id: alert.id, kind: alert.kind, message: alert.message, raisedAt: iso(alert.raised_at)! })),
  };
}

export async function overview(): Promise<OpsOverview> {
  const [byStatus, [counts], ending, pastDue, stuck, systemHealth] = await Promise.all([
    rows<{ status: AccountStatus; count: number }>(sql`select status, count(*)::int as count from tenants group by status`),
    rows<{ new_week: number; websites: number; members: number }>(
      sql`select
          (select count(*) from tenants where created_at > now() - interval '7 days')::int as new_week,
          (select count(*) from tenants where website_status in ('active', 'past_due'))::int as websites,
          (select count(*) from network_members)::int as members`,
    ),
    rows<TenantRowSql>(sql`${TENANT_ROW} where t.status = 'trial' and t.trial_ends_at between now() and now() + interval '3 days' order by t.trial_ends_at`),
    rows<TenantRowSql>(sql`${TENANT_ROW} where t.status = 'past_due' order by t.created_at desc`),
    rows<{ email: string; name: string; created_at: Date }>(
      sql`select u.email, u.name, u.created_at from "user" u
        where not exists (select 1 from memberships m where m.user_id = u.id)
        order by u.created_at desc limit 20`,
    ),
    health(),
  ]);
  return {
    businesses: Object.fromEntries(ACCOUNT_STATUSES.map((status) => [status, byStatus.find((row) => row.status === status)?.count ?? 0])) as OpsOverview["businesses"],
    newThisWeek: counts?.new_week ?? 0,
    trialsEndingSoon: ending.map(rowOf),
    pastDue: pastDue.map(rowOf),
    stuckSignups: stuck.map((user) => ({ email: user.email, name: user.name, createdAt: iso(user.created_at)! })),
    websites: counts?.websites ?? 0,
    networkMembers: counts?.members ?? 0,
    health: systemHealth,
    retention: RETENTION_RULES.map((rule) => ({ what: rule.what, keepDays: rule.keepDays })),
  };
}

/** Find a business by its name, web address, owner's email or phone number. */
export async function listTenants(query: string): Promise<OpsTenantRow[]> {
  const q = query.trim();
  const digits = q.replace(/\D/g, "");
  const like = `%${q.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
  const filter = q
    ? sql` where t.name ilike ${like} or t.slug ilike ${like}
        or exists (select 1 from memberships m join "user" u on u.id = m.user_id where m.tenant_id = t.id and u.email ilike ${like})
        ${digits.length >= 4 ? sql`or exists (select 1 from phone_numbers p where p.tenant_id = t.id and p.e164 like ${`%${digits}%`}) or t.owner_cell_e164 like ${`%${digits}%`}` : sql``}`
    : sql``;
  return (await rows<TenantRowSql>(sql`${TENANT_ROW}${filter} order by t.created_at desc limit 100`)).map(rowOf);
}

export async function tenantDetail(tenantId: string): Promise<OpsTenantDetail> {
  const [row] = await rows<TenantRowSql>(sql`${TENANT_ROW} where t.id = ${tenantId}`);
  if (!row) throw notFound("Business");
  const [[tenant], [extra], [activity], [member], failures, auditRows] = await Promise.all([
    systemDb.select().from(tenants).where(eq(tenants.id, tenantId)),
    rows<{ number: string | null; registration_status: string | null; registration_stage: string | null; payments: string | null; listing: boolean; calendar: boolean; owner_name: string | null }>(
      sql`select
          (select e164 from phone_numbers where tenant_id = ${tenantId} and status = 'active' limit 1) as number,
          (select status from carrier_registrations where tenant_id = ${tenantId} limit 1) as registration_status,
          (select stage from carrier_registrations where tenant_id = ${tenantId} limit 1) as registration_stage,
          (select status from payment_accounts where tenant_id = ${tenantId} limit 1) as payments,
          exists (select 1 from listing_connections where tenant_id = ${tenantId}) as listing,
          exists (select 1 from calendar_connections where tenant_id = ${tenantId}) as calendar,
          (select u.name from memberships m join "user" u on u.id = m.user_id where m.tenant_id = ${tenantId} and m.role = 'owner' limit 1) as owner_name`,
    ),
    rows<{ leads: number; calls: number; sent: number; failed: number; bookings: number }>(
      sql`select
          (select count(*) from leads where tenant_id = ${tenantId} and created_at > now() - interval '30 days')::int as leads,
          (select count(*) from calls where tenant_id = ${tenantId} and started_at > now() - interval '30 days')::int as calls,
          (select count(*) from messages where tenant_id = ${tenantId} and direction = 'outbound' and status in ('sent', 'delivered') and created_at > now() - interval '30 days')::int as sent,
          (select count(*) from messages where tenant_id = ${tenantId} and direction = 'outbound' and status = 'failed' and created_at > now() - interval '30 days')::int as failed,
          (select count(*) from bookings where tenant_id = ${tenantId} and created_at > now() - interval '30 days')::int as bookings`,
    ),
    systemDb.select().from(networkMembers).where(eq(networkMembers.tenantId, tenantId)),
    rows<{ at: Date; what: string; detail: string }>(
      sql`(select created_at as at, 'Message ' || channel as what, coalesce(error, blocked_reason, status) as detail
            from messages where tenant_id = ${tenantId} and status in ('failed', 'blocked') order by created_at desc limit 8)
        union all
        (select received_at as at, 'Webhook ' || provider as what, coalesce(error, event_type) as detail
            from webhook_inbox where tenant_id = ${tenantId} and status = 'failed' order by received_at desc limit 8)
        union all
        (select created_at as at, 'Server error' as what, route || ': ' || message as detail
            from system_errors where tenant_id = ${tenantId} order by created_at desc limit 8)
        order by at desc limit 15`,
    ),
    rows<{ created_at: Date; actor: string; action: string }>(
      sql`select created_at, actor, action from audit_log where tenant_id = ${tenantId} order by created_at desc, id desc limit 15`,
    ),
  ]);

  return {
    ...rowOf(row),
    ownerName: extra?.owner_name ?? tenant?.ownerName ?? null,
    ownerCell: tenant?.ownerCellE164 ?? null,
    trackingNumber: extra?.number ?? null,
    forwardingStatus: tenant?.forwardingStatus ?? "unknown",
    registration: extra?.registration_status ? { status: extra.registration_status, stage: extra.registration_stage } : null,
    billing: {
      customerId: tenant?.billingCustomerId ?? null,
      subscriptionId: tenant?.billingSubscriptionId ?? null,
      periodEnd: iso(tenant?.billingPeriodEnd),
      cancelsAt: iso(tenant?.billingCancelsAt),
      websiteStatus: tenant?.websiteStatus ?? "none",
    },
    integrations: { payments: extra?.payments ?? null, listing: extra?.listing ?? false, calendar: extra?.calendar ?? false },
    activity: {
      leads30d: activity?.leads ?? 0,
      calls30d: activity?.calls ?? 0,
      messagesSent30d: activity?.sent ?? 0,
      messagesFailed30d: activity?.failed ?? 0,
      bookings30d: activity?.bookings ?? 0,
    },
    network: member ? { available: member.available, termsVersion: member.termsVersion } : null,
    failures: failures.map((failure) => ({ at: iso(failure.at)!, what: failure.what, detail: failure.detail ?? "" })),
    audit: auditRows.map((entry) => ({ at: iso(entry.created_at)!, actor: entry.actor, action: entry.action })),
    profileUrl: profileUrl(row.slug),
  };
}

/** Support: stop a business (abuse, fraud, a legal hold). Its public pages and paid features go off at once. */
export async function suspendTenant(tenantId: string, operator: string, reason: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for("update");
    if (!tenant) throw notFound("Business");
    if (tenant.status === "suspended") throw new HttpError(409, "already_suspended", "This business is already suspended.");
    await tx.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, tenantId));
    await audit(tx, { tenantId, actor: `operator:${operator}`, action: "ops.suspended", entityType: "tenant", entityId: tenantId, data: { from: tenant.status, reason } });
    fx.publish({ type: "account.updated" });
  });
  return tenantDetail(tenantId);
}

/** Back on: a paying business returns to its plan, anyone else to their trial. */
export async function unsuspendTenant(tenantId: string, operator: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for("update");
    if (!tenant) throw notFound("Business");
    if (tenant.status !== "suspended") throw new HttpError(409, "not_suspended", "This business isn't suspended.");
    const to = tenant.billingSubscriptionId && tenant.tier ? "active" : "trial";
    await tx.update(tenants).set({ status: to }).where(eq(tenants.id, tenantId));
    await audit(tx, { tenantId, actor: `operator:${operator}`, action: "ops.unsuspended", entityType: "tenant", entityId: tenantId, data: { to } });
    fx.publish({ type: "account.updated" });
  });
  return tenantDetail(tenantId);
}

/** Onboarding support: more time on the free trial (from today when it already ran out). */
export async function extendTrial(tenantId: string, operator: string, days: number) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for("update");
    if (!tenant) throw notFound("Business");
    if (tenant.status !== "trial") throw new HttpError(409, "not_trial", "Only a business on its free trial can get more trial days.");
    const from = Math.max(Date.now(), tenant.trialEndsAt?.getTime() ?? 0);
    const until = new Date(from + days * 86_400_000);
    await tx.update(tenants).set({ trialEndsAt: until }).where(eq(tenants.id, tenantId));
    await audit(tx, { tenantId, actor: `operator:${operator}`, action: "ops.trial_extended", entityType: "tenant", entityId: tenantId, data: { days, until: until.toISOString() } });
    fx.publish({ type: "account.updated" });
  });
  return tenantDetail(tenantId);
}

/**
 * Data retention: once a business has cancelled, staff can erase its customers' data: customers,
 * jobs, messages, calls, chats and photos (files too). The business row, its billing history, the
 * consent ledger and the audit trail stay: they're the legal record. Typed confirmation required.
 */
export async function eraseCustomerData(tenantId: string, operator: string, confirm: string) {
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw notFound("Business");
  if (tenant.status !== "cancelled") throw new HttpError(409, "not_cancelled", "Only a business that has cancelled can have its data erased.");
  if (confirm.trim().toLowerCase() !== tenant.name.trim().toLowerCase()) {
    throw new HttpError(400, "confirm", "Type the business's name exactly to confirm.");
  }
  const files = await systemDb
    .select({ storageKey: mediaAssets.storageKey, thumbKey: mediaAssets.thumbKey })
    .from(mediaAssets)
    .where(eq(mediaAssets.tenantId, tenantId));
  const counts = await tenantWork(tenantId, async (tx, fx) => {
    const removed = {
      photos: (await tx.delete(mediaAssets).returning({ id: mediaAssets.id })).length,
      messages: (await tx.delete(messages).returning({ id: messages.id })).length,
      calls: (await tx.delete(calls).returning({ id: calls.id })).length,
      chats: (await tx.delete(conversations).returning({ id: conversations.id })).length,
      // Jobs, bookings, quotes, payment requests and review requests go with their customer.
      customers: (await tx.delete(customers).returning({ id: customers.id })).length,
    };
    await audit(tx, { tenantId, actor: `operator:${operator}`, action: "ops.customer_data_erased", entityType: "tenant", entityId: tenantId, data: removed });
    fx.publish({ type: "account.updated" });
    return removed;
  });
  // Files last: the rows pointing at them are already gone.
  for (const file of files) {
    for (const key of [file.storageKey, file.thumbKey]) {
      if (key) await storage.delete(key).catch((error: unknown) => logger.warn({ err: error, key }, "file not deleted"));
    }
  }
  return { ...counts, files: files.length };
}

/** C-24's vetting: staff can take a business out of the trusted pros network. */
export async function removeFromNetwork(tenantId: string, operator: string, reason: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [member] = await tx.delete(networkMembers).where(eq(networkMembers.tenantId, tenantId)).returning();
    if (!member) throw new HttpError(409, "not_member", "This business isn't in the network.");
    await tx
      .update(handoffOffers)
      .set({ status: "closed", respondedAt: new Date() })
      .where(sql`${handoffOffers.tenantId} = ${tenantId} and ${handoffOffers.status} = 'pending'`);
    await audit(tx, { tenantId, actor: `operator:${operator}`, action: "ops.network_removed", entityType: "tenant", entityId: tenantId, data: { reason } });
    fx.publish({ type: "network.updated" });
  });
  return tenantDetail(tenantId);
}
