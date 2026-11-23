import type { AudiencePreview, CampaignAudience } from "@leadanchor/contracts";
import { sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { emailOptOuts } from "../../db/schema";

/** The most one campaign sends; a small business's whole customer list fits many times over. */
export const MAX_RECIPIENTS = 2000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Short reasons someone is left out, as the owner sees them. */
const LEFT_OUT: Record<string, string> = {
  no_email: "No email address",
  unsubscribe_link: "Unsubscribed",
  complaint: "Marked an email as spam",
  bounce: "Email bounced",
  duplicate: "Shares an email with another customer",
  over_limit: `Over the ${MAX_RECIPIENTS.toLocaleString("en-US")} per campaign limit`,
};

export function audienceLabel(audience: CampaignAudience) {
  switch (audience.segment) {
    case "quiet":
      return `Past customers with no work in ${audience.months}+ months`;
    case "customers":
      return "All past customers";
    case "service":
      return `Customers who had ${audience.service ?? "a service"} done`;
    case "tag":
      return `Customers tagged “${audience.tag ?? ""}”`;
    case "not_booked":
      return `People who asked in the last ${audience.months} months but didn't book`;
  }
}

export interface Reachable {
  customerId: string;
  name: string | null;
  email: string;
  /** The relationship that makes the email lawful, for the audit trail. */
  basis: string;
  /** The footer's "you're getting it because …". */
  reason: string;
}

export interface LeftOut {
  customerId: string;
  name: string | null;
  email: string | null;
  basis: string;
  reason: string;
}

export interface Audience {
  matching: number;
  reachable: Reachable[];
  leftOut: LeftOut[];
}

const monthYear = (date: Date) =>
  date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Who a campaign goes to, worked out fresh each time (an unsubscribe since yesterday counts). Only
 * people already in LeadAnchor through their own jobs or requests: never an uploaded list (C-44).
 */
export async function resolveAudience(
  tx: Tx,
  tenant: { id: string; name: string },
  audience: CampaignAudience,
): Promise<Audience> {
  const condition = {
    quiet: sql`h.won > 0 and h.open = 0 and h.last_won < now() - make_interval(months => ${audience.months})`,
    customers: sql`h.won > 0`,
    service: sql`h.had_service`,
    tag: sql`h.tagged`,
    not_booked: sql`h.won = 0 and h.open = 0 and h.last_lost > now() - make_interval(months => ${audience.months})`,
  }[audience.segment];

  const rows = (
    await tx.execute(sql`
      with h as (
        select l.customer_id,
          count(*) filter (where l.stage = 'won')::int as won,
          max(l.won_at) as last_won,
          count(*) filter (where l.stage not in ('won', 'lost'))::int as open,
          max(l.stage_changed_at) filter (where l.stage = 'lost') as last_lost,
          bool_or(exists (select 1 from unnest(l.tags) t where lower(t) = lower(${audience.tag ?? ""}))) as tagged,
          bool_or(l.stage = 'won' and lower(coalesce(l.service_category, '')) = lower(${audience.service ?? ""})) as had_service
        from leads l
        where l.tenant_id = ${tenant.id}
        group by l.customer_id
      )
      select c.id, c.name, c.email, h.won, h.last_won
      from customers c
      join h on h.customer_id = c.id
      where c.tenant_id = ${tenant.id} and ${condition}
      order by coalesce(h.last_won, c.last_contact_at) desc, c.id
      limit 10000
    `)
  ).rows as Array<{
    id: string;
    name: string | null;
    email: string | null;
    won: number;
    last_won: Date | string | null;
  }>;

  const suppressed = new Map(
    (
      await tx.select({ email: emailOptOuts.email, source: emailOptOuts.source }).from(emailOptOuts)
    ).map((row) => [row.email, row.source]),
  );
  const seen = new Set<string>();
  const reachable: Reachable[] = [];
  const leftOut: LeftOut[] = [];
  for (const row of rows) {
    const email = row.email?.trim().toLowerCase() ?? "";
    const lastWon = row.last_won ? new Date(row.last_won) : null;
    const person = {
      customerId: row.id,
      name: row.name,
      basis:
        row.won > 0
          ? `Customer: work done${lastWon ? ` ${monthYear(lastWon)}` : ""}`
          : "Asked about a job",
    };
    if (!EMAIL.test(email)) leftOut.push({ ...person, email: null, reason: LEFT_OUT.no_email! });
    else if (suppressed.has(email))
      leftOut.push({
        ...person,
        email,
        reason: LEFT_OUT[suppressed.get(email)!] ?? LEFT_OUT.unsubscribe_link!,
      });
    else if (seen.has(email)) leftOut.push({ ...person, email, reason: LEFT_OUT.duplicate! });
    else if (reachable.length >= MAX_RECIPIENTS)
      leftOut.push({ ...person, email, reason: LEFT_OUT.over_limit! });
    else {
      seen.add(email);
      reachable.push({
        ...person,
        email,
        reason:
          row.won > 0 ? `${tenant.name} did work for you` : `you asked ${tenant.name} about a job`,
      });
    }
  }
  return { matching: rows.length, reachable, leftOut };
}

/** Left-out people counted by reason, biggest first. */
export function leftOutSummary(leftOut: LeftOut[]) {
  const counts = new Map<string, number>();
  for (const person of leftOut) counts.set(person.reason, (counts.get(person.reason) ?? 0) + 1);
  return [...counts]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export function previewOf(audience: Audience): AudiencePreview {
  return {
    matching: audience.matching,
    reachable: audience.reachable.length,
    skipped: leftOutSummary(audience.leftOut),
    sample: audience.reachable
      .slice(0, 8)
      .map((person) => ({ name: person.name ?? person.email, email: person.email })),
  };
}
