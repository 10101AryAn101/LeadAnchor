import {
  DAYPARTS,
  type Daypart,
  LEAD_SOURCES,
  type LeadSource,
  PAYMENT_METHODS,
  type PaymentMethod,
  type ReportPeriod,
  type ReportsResponse,
} from "@leadanchor/contracts";
import { type SQL, sql } from "drizzle-orm";
import { type Tx, withTenant } from "../../db/client";

/** Missed calls LeadAnchor caught (the same set the dashboard counts). */
const CAPTURED = ["ghost", "voicemail", "dispatcher_completed", "dispatcher_abandoned"];
/** The owner reaching a new lead: a tap on Call or Text, or answering their call. */
const CONTACT_EVENTS = ["contact.started", "call.answered"];

const PERIOD: Record<ReportPeriod, { days: number; unit: "week" | "month" }> = {
  "30d": { days: 30, unit: "week" },
  "90d": { days: 90, unit: "week" },
  "12m": { days: 365, unit: "month" },
};

const rows = async <T>(tx: Tx, query: SQL) => (await tx.execute(query)).rows as T[];
const num = (value: unknown) => Number(value ?? 0);

/**
 * Module 10: the fixed suite of reports, all aggregations over the business's own records for the
 * period, in its time zone. Money counts only real values the owner entered and payments received.
 */
export async function getReports(tenantId: string, period: ReportPeriod): Promise<ReportsResponse> {
  const { days, unit } = PERIOD[period];
  return withTenant(tenantId, async (tx) => {
    const [zone] = await rows<{ tz: string }>(tx, sql`select timezone as tz from tenants where id = ${tenantId}`);
    const tz = zone?.tz ?? "America/Chicago";
    const since = sql`(date_trunc('day', now() at time zone ${tz}) - make_interval(days => ${days - 1})) at time zone ${tz}`;
    const step = sql.raw(`interval '1 ${unit}'`);
    const trunc = sql.raw(`'${unit}'`);

    const [money] = await rows<Record<string, unknown>>(
      tx,
      sql`select
        (select coalesce(sum(value_cents), 0) from leads where stage = 'won' and won_at >= ${since}) as won,
        (select avg(value_cents) from leads where stage = 'won' and won_at >= ${since} and value_cents is not null) as average,
        (select coalesce(sum(amount_cents), 0) from payment_requests where status = 'paid' and paid_at >= ${since}) as collected,
        (select coalesce(sum(amount_cents), 0) from payment_requests where status = 'held') as held,
        (select coalesce(sum(amount_cents), 0) from payment_requests where status = 'open') as open`,
    );
    const buckets = await rows<{ start: string; won: string; collected: string }>(
      tx,
      sql`with buckets as (
          select generate_series(date_trunc(${trunc}, ${since} at time zone ${tz}), date_trunc(${trunc}, now() at time zone ${tz}), ${step}) as start
        )
        select to_char(b.start, 'YYYY-MM-DD') as start,
          (select coalesce(sum(value_cents), 0) from leads
            where stage = 'won' and won_at >= ${since} and date_trunc(${trunc}, won_at at time zone ${tz}) = b.start) as won,
          (select coalesce(sum(amount_cents), 0) from payment_requests
            where status = 'paid' and paid_at >= ${since} and date_trunc(${trunc}, paid_at at time zone ${tz}) = b.start) as collected
        from buckets b order by b.start`,
    );
    const methods = await rows<{ method: PaymentMethod; count: number; cents: string }>(
      tx,
      sql`select coalesce(method, 'other') as method, count(*)::int as count, sum(amount_cents) as cents
        from payment_requests where status = 'paid' and paid_at >= ${since} group by 1 order by 3 desc`,
    );

    const sources = await rows<{ source: LeadSource; leads: number; won: number; won_cents: string }>(
      tx,
      sql`select source, count(*)::int as leads, count(*) filter (where stage = 'won')::int as won,
          coalesce(sum(value_cents) filter (where stage = 'won'), 0) as won_cents
        from leads where created_at >= ${since} group by source order by leads desc`,
    );

    const [calls] = await rows<Record<string, number>>(
      tx,
      sql`select count(*)::int as total,
          count(*) filter (where outcome = 'answered')::int as answered,
          count(*) filter (where outcome in ${CAPTURED})::int as missed,
          count(*) filter (where outcome = 'ghost')::int as ghost,
          count(*) filter (where outcome = 'voicemail')::int as voicemail,
          count(*) filter (where outcome in ('dispatcher_completed', 'dispatcher_abandoned'))::int as dispatcher,
          count(*) filter (where outcome in ${CAPTURED} and lead_id is not null)::int as to_leads
        from calls where started_at >= ${since}`,
    );
    const byTime = await rows<{ weekday: number; daypart: Daypart; missed: number }>(
      tx,
      sql`select extract(dow from started_at at time zone ${tz})::int as weekday,
          case
            when extract(hour from started_at at time zone ${tz}) between 6 and 11 then 'morning'
            when extract(hour from started_at at time zone ${tz}) between 12 and 16 then 'afternoon'
            when extract(hour from started_at at time zone ${tz}) between 17 and 21 then 'evening'
            else 'night'
          end as daypart,
          count(*)::int as missed
        from calls where started_at >= ${since} and outcome in ${CAPTURED} group by 1, 2`,
    );

    // Leads the owner had to reach: not ones they added themselves.
    const [response] = await rows<Record<string, unknown>>(
      tx,
      sql`with firsts as (
          select l.created_at,
            (select min(e.created_at) from lead_events e where e.lead_id = l.id and e.type in ${CONTACT_EVENTS}) as reached
          from leads l where l.created_at >= ${since} and l.source not in ('manual', 'network', 'membership')
        )
        select count(*)::int as leads, count(reached)::int as contacted,
          percentile_cont(0.5) within group (order by extract(epoch from reached - created_at) / 60) filter (where reached is not null) as median,
          count(*) filter (where reached - created_at <= interval '5 minutes')::int as within5,
          count(*) filter (where reached - created_at <= interval '60 minutes')::int as within60
        from firsts`,
    );

    const [bookings] = await rows<Record<string, number>>(
      tx,
      sql`select count(*) filter (where created_at >= ${since})::int as total,
          count(*) filter (where created_at >= ${since} and source = 'customer')::int as online,
          count(*) filter (where created_at >= ${since} and source = 'owner')::int as by_owner,
          count(*) filter (where created_at >= ${since} and source = 'waitlist')::int as from_waitlist,
          count(*) filter (where starts_at >= ${since} and status = 'completed')::int as completed,
          count(*) filter (where starts_at >= ${since} and status = 'no_show')::int as no_shows,
          count(*) filter (where canceled_at >= ${since})::int as canceled
        from bookings`,
    );

    const [reviews] = await rows<Record<string, unknown>>(
      tx,
      sql`select
          (select count(*) from review_requests where sent_at >= ${since})::int as requested,
          (select count(*) from reviews where published_at >= ${since})::int as received,
          (select avg(rating) from reviews where published_at >= ${since}) as average,
          (select count(*) from reviews where reply_posted_at >= ${since})::int as replied`,
    );

    const campaigns = await rows<{ id: string; name: string; sent_at: Date | string; sent: number; clicked: number; booked: number }>(
      tx,
      sql`select c.id, c.name, c.sent_at,
          count(r.id) filter (where r.status = 'sent')::int as sent,
          count(r.id) filter (where r.clicked_at is not null)::int as clicked,
          count(r.id) filter (where r.booked_at is not null)::int as booked
        from campaigns c left join campaign_recipients r on r.campaign_id = c.id
        where c.sent_at >= ${since}
        group by c.id order by c.sent_at desc limit 12`,
    );

    const [first] = await rows<{ day: string }>(tx, sql`select to_char(${since} at time zone ${tz}, 'YYYY-MM-DD') as day`);

    return {
      period,
      from: first?.day ?? "",
      money: {
        wonCents: num(money?.won),
        collectedCents: num(money?.collected),
        heldCents: num(money?.held),
        openCents: num(money?.open),
        averageJobCents: money?.average == null ? null : Math.round(num(money.average)),
        buckets: buckets.map((bucket) => ({ start: bucket.start, wonCents: num(bucket.won), collectedCents: num(bucket.collected) })),
        byMethod: methods
          .filter((row) => (PAYMENT_METHODS as readonly string[]).includes(row.method))
          .map((row) => ({ method: row.method, count: row.count, cents: num(row.cents) })),
      },
      sources: sources
        .filter((row) => (LEAD_SOURCES as readonly string[]).includes(row.source))
        .map((row) => ({ source: row.source, leads: row.leads, won: row.won, wonCents: num(row.won_cents) })),
      calls: {
        total: num(calls?.total),
        answered: num(calls?.answered),
        missed: num(calls?.missed),
        ghost: num(calls?.ghost),
        voicemail: num(calls?.voicemail),
        dispatcher: num(calls?.dispatcher),
        toLeads: num(calls?.to_leads),
        byTime: byTime.filter((row) => (DAYPARTS as readonly string[]).includes(row.daypart)),
      },
      response: {
        leads: num(response?.leads),
        contacted: num(response?.contacted),
        medianMinutes: response?.median == null ? null : Math.round(num(response.median) * 10) / 10,
        within5: num(response?.within5),
        within60: num(response?.within60),
      },
      bookings: {
        total: num(bookings?.total),
        online: num(bookings?.online),
        byOwner: num(bookings?.by_owner),
        fromWaitlist: num(bookings?.from_waitlist),
        completed: num(bookings?.completed),
        noShows: num(bookings?.no_shows),
        canceled: num(bookings?.canceled),
      },
      reviews: {
        requested: num(reviews?.requested),
        received: num(reviews?.received),
        averageRating: reviews?.average == null ? null : Math.round(num(reviews.average) * 10) / 10,
        replied: num(reviews?.replied),
      },
      campaigns: campaigns.map((row) => ({
        id: row.id,
        name: row.name,
        sentAt: new Date(row.sent_at).toISOString(),
        sent: row.sent,
        clicked: row.clicked,
        booked: row.booked,
      })),
    };
  });
}
