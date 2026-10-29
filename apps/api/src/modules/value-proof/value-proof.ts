import { and, eq, ne, sql } from "drizzle-orm";
import { linkBaseUrl } from "../../config/env";
import { systemDb } from "../../db/client";
import { memberships, tenants, user } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { logger } from "../../lib/logger";
import { requestEmail } from "../messaging/send-path";
import { notifyOwner } from "../notifications/notify";

/** Summaries go out at 8 AM in the business's own time zone. */
const SEND_HOUR = 8;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CAPTURED = ["ghost", "voicemail", "dispatcher_completed", "dispatcher_abandoned"];
const CALL_SOURCES = ["missed_call", "voicemail", "ai_dispatcher"];

type Frequency = "daily" | "weekly" | "off";

export interface PeriodNumbers {
  caught: number;
  dispatcher: number;
  leads: number;
  wonFromCalls: number;
  recoveredCents: number;
}

/** Calendar day, weekday (1 = Monday) and hour of `date` in `timeZone`. */
export function localParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "numeric", hourCycle: "h23" })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, weekday: WEEKDAYS.indexOf(parts.weekday ?? "") + 1, hour: Number(parts.hour) % 24 };
}

/** Daily: once a day from 8 AM. Weekly: Monday from 8 AM, or as soon as a week has passed (e.g. the app was off on Monday). */
export function summaryDue(frequency: Frequency, lastSentAt: Date | null, now: Date, timeZone: string) {
  if (frequency === "off") return false;
  const local = localParts(now, timeZone);
  if (local.hour < SEND_HOUR) return false;
  if (lastSentAt && localParts(lastSentAt, timeZone).day === local.day) return false;
  if (frequency === "daily") return true;
  const weekPassed = lastSentAt !== null && now.getTime() - lastSentAt.getTime() >= 7 * 86_400_000;
  return local.weekday === 1 || weekPassed;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** C-40: plain words, real attributed numbers only — never estimates. */
export function summaryText(frequency: "daily" | "weekly", n: PeriodNumbers) {
  const title = frequency === "daily" ? "Your day with LeadAnchor" : "Your week with LeadAnchor";
  const period = frequency === "daily" ? "In the last 24 hours" : "In the last 7 days";
  const caught =
    n.caught === 0 && n.leads === 0
      ? `${period} there were no missed calls to catch.`
      : `${period} LeadAnchor caught ${count(n.caught, "missed call")}${n.dispatcher > 0 ? ` (${n.dispatcher} answered by the AI Dispatcher)` : ""} and put ${count(n.leads, "lead")} on your board.`;
  const won =
    n.wonFromCalls > 0
      ? ` You won ${count(n.wonFromCalls, "job")} worth ${usd.format(n.recoveredCents / 100)} from calls you would have missed.`
      : " Mark jobs as won with their value to see what they were worth.";
  return { title, body: caught + won };
}

/** Sends one summary now: an alert in the app (and push, when connected) plus an email to each owner. */
export async function sendValueProof(tenantId: string, now = new Date()) {
  const owners = await systemDb
    .select({ email: user.email })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "owner")));

  await tenantWork(tenantId, async (tx, fx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) return;
    const frequency = tenant.valueProofFrequency === "daily" ? "daily" : "weekly";
    const since = new Date(now.getTime() - (frequency === "daily" ? 1 : 7) * 86_400_000);

    const numbers = (
      await tx.execute(sql`
        select
          (select count(*) from calls where started_at >= ${since} and outcome in ${CAPTURED})::int as caught,
          (select count(*) from calls where started_at >= ${since} and outcome in ('dispatcher_completed', 'dispatcher_abandoned'))::int as dispatcher,
          (select count(*) from leads where created_at >= ${since})::int as leads,
          (select count(*) from leads where stage = 'won' and won_at >= ${since} and source in ${CALL_SOURCES})::int as won_from_calls,
          (select coalesce(sum(value_cents), 0) from leads where stage = 'won' and won_at >= ${since} and source in ${CALL_SOURCES})::bigint as recovered`)
    ).rows[0] as { caught: number; dispatcher: number; leads: number; won_from_calls: number; recovered: string };

    const { title, body } = summaryText(frequency, {
      caught: numbers.caught,
      dispatcher: numbers.dispatcher,
      leads: numbers.leads,
      wonFromCalls: numbers.won_from_calls,
      recoveredCents: Number(numbers.recovered),
    });

    await notifyOwner(tx, fx, { tenantId, kind: "value_proof", title, body, leadId: null });
    for (const owner of owners) {
      await requestEmail(tx, fx, {
        tenant,
        customerId: null,
        leadId: null,
        to: owner.email,
        subject: title,
        body: `${body}\n\nSee the details: ${linkBaseUrl}/dashboard\n\nChange how often this arrives in Settings, under "Your summary".`,
        purpose: "transactional",
      });
    }
    await tx.update(tenants).set({ valueProofLastSentAt: now }).where(eq(tenants.id, tenantId));
  });
}

/** Scheduled every 15 minutes: sends each business's summary once it is due. */
export async function valueProofTickJob() {
  const now = new Date();
  const due = await systemDb
    .select({ id: tenants.id, timezone: tenants.timezone, frequency: tenants.valueProofFrequency, lastSentAt: tenants.valueProofLastSentAt })
    .from(tenants)
    .where(ne(tenants.valueProofFrequency, "off"));

  for (const tenant of due) {
    if (!summaryDue(tenant.frequency, tenant.lastSentAt, now, tenant.timezone)) continue;
    try {
      await sendValueProof(tenant.id, now);
    } catch (error) {
      logger.error({ err: error, tenantId: tenant.id }, "value-proof summary failed");
    }
  }
}
