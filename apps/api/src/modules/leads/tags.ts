import { STARTER_TAGS, type TagsResponse } from "@leadanchor/contracts";
import { eq, sql } from "drizzle-orm";
import { type Tx, withTenant } from "../../db/client";
import { leads, tenants } from "../../db/schema";

/**
 * Job tags (module 4): the owner's own labels, such as "Warranty". They live on the
 * job, filter both board views, and will pick campaign audiences later (C-44).
 */

/** Every tag the business uses and how many jobs carry it, most used first. */
async function tagCounts(tx: Tx) {
  const result = await tx.execute<{ name: string; count: number }>(
    sql`select tag as name, count(*)::int as count from ${leads}, unnest(${leads.tags}) as tag group by tag order by count(*) desc, tag`,
  );
  return result.rows;
}

export async function listTags(tenantId: string): Promise<TagsResponse> {
  return withTenant(tenantId, async (tx) => {
    const tags = await tagCounts(tx);
    const [tenant] = await tx.select({ track: tenants.track }).from(tenants).where(eq(tenants.id, tenantId));
    const used = new Set(tags.map((tag) => tag.name.toLowerCase()));
    return { tags, suggestions: STARTER_TAGS[tenant?.track ?? "A"].filter((name) => !used.has(name.toLowerCase())) };
  });
}

/**
 * One spelling per tag across the business: "warranty" becomes "Warranty" (a starter
 * tag's own spelling, else the one already in use), and repeats on a job collapse into one.
 */
export async function canonicalTags(tx: Tx, tenantId: string, tags: string[]) {
  const [tenant] = await tx.select({ track: tenants.track }).from(tenants).where(eq(tenants.id, tenantId));
  const existing = new Map([
    ...(await tagCounts(tx)).map((tag) => [tag.name.toLowerCase(), tag.name] as const),
    ...STARTER_TAGS[tenant?.track ?? "A"].map((name) => [name.toLowerCase(), name] as const),
  ]);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(existing.get(key) ?? tag);
  }
  return result;
}
