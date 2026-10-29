import type { CustomerDetail, CustomerListItem } from "@leadanchor/contracts";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { withTenant } from "../../db/client";
import { calls, customers, leads, mediaAssets } from "../../db/schema";
import { notFound } from "../../lib/errors";
import { iso } from "../../lib/time";
import { toCallItem } from "../leads/lead.service";
import { paymentsFor } from "../payments/payment.service";
import { quotesFor } from "../quotes/quote.service";

/** Everyone who has called or sent a form, most recent first (C-34). `search` matches a name or phone digits. */
export async function listCustomers(tenantId: string, search = ""): Promise<CustomerListItem[]> {
  const term = search.trim();
  const digits = term.replace(/\D/g, "");
  return withTenant(tenantId, async (tx) => {
    const rows = (
      await tx.execute(sql`
        select c.id, c.name, c.phone_e164 as phone,
          count(l.id)::int as jobs,
          count(l.id) filter (where l.stage not in ('won', 'lost'))::int as open_jobs,
          count(l.id) filter (where l.stage = 'won')::int as won_jobs,
          coalesce(sum(l.value_cents) filter (where l.stage = 'won'), 0)::bigint as lifetime_value,
          greatest(c.last_contact_at, max(l.last_activity_at)) as last_activity
        from customers c
        left join leads l on l.customer_id = c.id
        where ${term} = ''
          or c.name ilike ${`%${term}%`}
          or (${digits} <> '' and c.phone_e164 like ${`%${digits}%`})
        group by c.id
        order by last_activity desc nulls last
        limit 200`)
    ).rows as Array<{
      id: string;
      name: string | null;
      phone: string | null;
      jobs: number;
      open_jobs: number;
      won_jobs: number;
      lifetime_value: string;
      last_activity: Date | string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      jobs: row.jobs,
      openJobs: row.open_jobs,
      wonJobs: row.won_jobs,
      lifetimeValueCents: Number(row.lifetime_value),
      lastActivityAt: new Date(row.last_activity).toISOString(),
    }));
  });
}

/** One customer's whole story: every job, call, photo, quote and payment, and what they've spent. Read-only. */
export async function getCustomer(tenantId: string, customerId: string): Promise<CustomerDetail> {
  return withTenant(tenantId, async (tx) => {
    const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId));
    if (!customer) throw notFound("Customer");

    const [jobs, callRows] = await Promise.all([
      tx.select().from(leads).where(eq(leads.customerId, customerId)).orderBy(desc(leads.createdAt)),
      tx.select().from(calls).where(eq(calls.customerId, customerId)).orderBy(desc(calls.startedAt)).limit(50),
    ]);
    const jobIds = jobs.map((job) => job.id);
    const [photos, quoteItems, paymentItems] = await Promise.all([
      jobs.length === 0
        ? []
        : tx
            .select({ id: mediaAssets.id, leadId: mediaAssets.leadId, aiTags: mediaAssets.aiTags, createdAt: mediaAssets.createdAt })
            .from(mediaAssets)
            .where(and(inArray(mediaAssets.leadId, jobIds), eq(mediaAssets.kind, "photo")))
            .orderBy(desc(mediaAssets.createdAt)),
      quotesFor(tx, jobIds),
      paymentsFor(tx, jobIds),
    ]);

    const won = jobs.filter((job) => job.stage === "won");
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phoneE164,
      email: customer.email,
      address: customer.address,
      firstSeenAt: customer.firstSeenAt.toISOString(),
      stats: {
        jobs: jobs.length,
        openJobs: jobs.filter((job) => job.stage !== "won" && job.stage !== "lost").length,
        wonJobs: won.length,
        lifetimeValueCents: won.reduce((sum, job) => sum + (job.valueCents ?? 0), 0),
        paidCents: paymentItems.filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + payment.amountCents, 0),
      },
      quotes: quoteItems,
      payments: paymentItems,
      jobs: jobs.map((job) => ({
        id: job.id,
        title: job.title,
        stage: job.stage,
        source: job.source,
        serviceCategory: job.serviceCategory,
        urgency: job.urgency,
        valueCents: job.valueCents,
        estimatedValueCents: job.estimatedValueCents,
        scheduledFor: iso(job.scheduledFor),
        tags: job.tags,
        createdAt: job.createdAt.toISOString(),
        wonAt: iso(job.wonAt),
      })),
      calls: callRows.map((call) => toCallItem(call, customer)),
      photos: photos.map((photo) => ({
        id: photo.id,
        leadId: photo.leadId!,
        issue: (photo.aiTags as { issue?: string } | null)?.issue ?? null,
        createdAt: photo.createdAt.toISOString(),
      })),
    };
  });
}
