import { monthlyCents } from "@leadanchor/contracts";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { type Tx, systemDb } from "../../db/client";
import {
  membershipIncomeMonths,
  membershipInvoices,
  planMemberships,
  tenants,
} from "../../db/schema";
import { monthOf, monthsEnding } from "./months";

/**
 * C-50: recurring income kept month by month, so "this month against last" is real rather than a
 * 30-day estimate. Each business's current month is brought up to date (active members only, as
 * the headline counts them); once the month is over, its row is the month's closing figure.
 */
export async function recordIncomeMonths(now = new Date()) {
  const rows = await systemDb
    .select({
      tenantId: planMemberships.tenantId,
      timezone: tenants.timezone,
      status: planMemberships.status,
      priceCents: planMemberships.priceCents,
      interval: planMemberships.interval,
    })
    .from(planMemberships)
    .innerJoin(tenants, eq(tenants.id, planMemberships.tenantId))
    .where(inArray(planMemberships.status, ["active", "past_due", "paused", "canceled"]));
  const byTenant = new Map<string, { timezone: string; mrrCents: number; active: number }>();
  for (const row of rows) {
    const entry = byTenant.get(row.tenantId) ?? { timezone: row.timezone, mrrCents: 0, active: 0 };
    if (row.status === "active") {
      entry.mrrCents += monthlyCents(row.priceCents, row.interval);
      entry.active += 1;
    }
    byTenant.set(row.tenantId, entry);
  }
  for (const [tenantId, entry] of byTenant) {
    await systemDb
      .insert(membershipIncomeMonths)
      .values({
        tenantId,
        month: monthOf(now, entry.timezone),
        mrrCents: entry.mrrCents,
        activeMembers: entry.active,
      })
      .onConflictDoUpdate({
        target: [membershipIncomeMonths.tenantId, membershipIncomeMonths.month],
        set: { mrrCents: entry.mrrCents, activeMembers: entry.active, updatedAt: now },
      });
  }
  return byTenant.size;
}

/**
 * The last 12 months: money members actually paid each month (from the paid bills), and the
 * recurring income at the month's end (null for months before the record began).
 */
export async function incomeHistory(tx: Tx, timeZone: string, now = new Date()) {
  const months = monthsEnding(monthOf(now, timeZone), 12);
  const [paid, recorded] = await Promise.all([
    tx
      .select({
        month: sql<string>`to_char(${membershipInvoices.paidAt} at time zone ${timeZone}, 'YYYY-MM')`,
        cents: sql<number>`coalesce(sum(${membershipInvoices.amountCents}), 0)::int`,
      })
      .from(membershipInvoices)
      .where(
        and(
          eq(membershipInvoices.status, "paid"),
          gte(membershipInvoices.paidAt, new Date(now.getTime() - 400 * 86_400_000)),
        ),
      )
      .groupBy(sql`1`),
    tx
      .select({ month: membershipIncomeMonths.month, mrrCents: membershipIncomeMonths.mrrCents })
      .from(membershipIncomeMonths)
      .where(inArray(membershipIncomeMonths.month, months)),
  ]);
  const collected = new Map(paid.map((row) => [row.month, row.cents]));
  const mrr = new Map(recorded.map((row) => [row.month, row.mrrCents]));
  return months.map((month) => ({
    month,
    collectedCents: collected.get(month) ?? 0,
    mrrCents: mrr.get(month) ?? null,
  }));
}
