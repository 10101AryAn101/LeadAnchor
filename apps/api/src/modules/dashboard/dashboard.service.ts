import { type DashboardRange, type DashboardSummary, LEAD_SOURCES, type LeadSource } from "@leadanchor/contracts";
import { sql } from "drizzle-orm";
import { withTenant } from "../../db/client";

const RANGE_DAYS: Record<DashboardRange, number> = { "7d": 7, "30d": 30, "90d": 90 };
const CAPTURED = ["ghost", "voicemail", "dispatcher_completed", "dispatcher_abandoned"];
const CALL_SOURCES: LeadSource[] = ["missed_call", "voicemail", "ai_dispatcher"];

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);

/**
 * Dashboard metrics (C-14) and the value-proof summary (C-40).
 * "Recovered" only counts real job values the owner entered on won leads that
 * started as a missed call — never estimates (AC: "real attributed numbers only").
 */
export async function getDashboard(tenantId: string, range: DashboardRange): Promise<DashboardSummary> {
  const days = RANGE_DAYS[range];

  return withTenant(tenantId, async (tx) => {
    const tzRow = (await tx.execute(sql`select timezone as tz from tenants where id = ${tenantId}`)).rows[0] as { tz: string } | undefined;
    const tz = tzRow?.tz ?? "America/Chicago";
    const since = sql`(date_trunc('day', now() at time zone ${tz}) - make_interval(days => ${days - 1})) at time zone ${tz}`;

    const callRow = (
      await tx.execute(sql`
        select
          count(*) filter (where outcome = 'answered')::int as answered,
          count(*) filter (where outcome in ${CAPTURED})::int as captured,
          count(*) filter (where outcome = 'ghost')::int as ghost,
          count(*) filter (where outcome in ('dispatcher_completed', 'dispatcher_abandoned'))::int as dispatcher,
          count(*) filter (where outcome = 'voicemail')::int as voicemail
        from calls where started_at >= ${since}`)
    ).rows[0] as { answered: number; captured: number; ghost: number; dispatcher: number; voicemail: number };

    const leadRow = (
      await tx.execute(sql`
        select
          count(*) filter (where created_at >= ${since})::int as created,
          count(*) filter (where stage = 'won' and won_at >= ${since})::int as won,
          coalesce(sum(value_cents) filter (where stage = 'won' and won_at >= ${since} and source in ${CALL_SOURCES}), 0)::bigint as recovered,
          coalesce(sum(coalesce(value_cents, estimated_value_cents)) filter (where stage not in ('won', 'lost')), 0)::bigint as pipeline,
          count(*) filter (where needs_callback and stage not in ('won', 'lost'))::int as callbacks
        from leads`)
    ).rows[0] as { created: number; won: number; recovered: string; pipeline: string; callbacks: number };

    const seriesRows = (
      await tx.execute(sql`
        with days as (
          select generate_series(date_trunc('day', now() at time zone ${tz}) - make_interval(days => ${days - 1}),
                                 date_trunc('day', now() at time zone ${tz}), interval '1 day')::date as day
        )
        select to_char(d.day, 'YYYY-MM-DD') as date,
          (select count(*) from calls c where outcome in ${CAPTURED} and (c.started_at at time zone ${tz})::date = d.day)::int as captured,
          (select count(*) from leads l where stage = 'won' and (l.won_at at time zone ${tz})::date = d.day)::int as won
        from days d order by d.day`)
    ).rows as Array<{ date: string; captured: number; won: number }>;

    const sourceRows = (
      await tx.execute(sql`select source, count(*)::int as count from leads where created_at >= ${since} group by source order by count desc`)
    ).rows as Array<{ source: LeadSource; count: number }>;

    const recoveredCents = Number(leadRow.recovered);
    const pipelineCents = Number(leadRow.pipeline);
    const missed = callRow.captured;
    const period = range === "7d" ? "This week" : range === "30d" ? "In the last 30 days" : "In the last 90 days";

    const headline =
      missed === 0
        ? `${period} every call was answered by you — nothing slipped through.`
        : `${period} LeadAnchor caught ${missed} missed call${missed === 1 ? "" : "s"} and put ${leadRow.created} lead${leadRow.created === 1 ? "" : "s"} on your board.`;
    const detail =
      recoveredCents > 0
        ? `${money(recoveredCents)} in won jobs started as a missed call.`
        : `Mark jobs as won with their value to see the money you recovered.`;

    return {
      range,
      recoveredCents,
      pipelineCents,
      missedCalls: missed,
      callsCaptured: missed,
      answeredCalls: callRow.answered,
      ghostCalls: callRow.ghost,
      dispatcherConversations: callRow.dispatcher,
      voicemails: callRow.voicemail,
      leadsCreated: leadRow.created,
      leadsWon: leadRow.won,
      winRate: leadRow.created > 0 ? leadRow.won / leadRow.created : 0,
      needsCallback: leadRow.callbacks,
      series: seriesRows,
      sources: sourceRows.filter((row) => (LEAD_SOURCES as readonly string[]).includes(row.source)),
      valueProof: { headline, detail },
    };
  });
}
