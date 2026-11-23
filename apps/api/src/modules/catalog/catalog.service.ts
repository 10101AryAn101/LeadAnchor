import type { ServiceInput, ServiceItem, ServiceUpdateInput } from "@leadanchor/contracts";
import { asc, desc, eq } from "drizzle-orm";
import { withTenant } from "../../db/client";
import { services } from "../../db/schema";
import { notFound } from "../../lib/errors";
import { audit } from "../compliance/audit";

type ServiceRow = typeof services.$inferSelect;

const toItem = (s: ServiceRow): ServiceItem => ({
  id: s.id,
  name: s.name,
  description: s.description,
  durationMins: s.durationMins,
  priceCents: s.priceCents,
  active: s.active,
  sortOrder: s.sortOrder,
});

const toCents = (dollars: number | null | undefined) => (dollars == null ? null : Math.round(dollars * 100));

/**
 * The business's services, how long each takes and what it costs (C-17). Active ones
 * appear on the customer request form and guide the AI; quotes and booking build on them.
 * Hiding a service keeps it for history instead of deleting it.
 */
export async function listServices(tenantId: string): Promise<ServiceItem[]> {
  return withTenant(tenantId, async (tx) => (await tx.select().from(services).orderBy(asc(services.sortOrder), asc(services.createdAt))).map(toItem));
}

export async function createService(tenantId: string, userId: string, input: ServiceInput): Promise<ServiceItem> {
  return withTenant(tenantId, async (tx) => {
    const [last] = await tx.select({ sortOrder: services.sortOrder }).from(services).orderBy(desc(services.sortOrder)).limit(1);
    const [row] = await tx
      .insert(services)
      .values({
        tenantId,
        name: input.name,
        description: input.description ?? null,
        durationMins: input.durationMins ?? null,
        priceCents: toCents(input.priceDollars),
        active: input.active ?? true,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      })
      .returning();
    await audit(tx, { tenantId, actor: `user:${userId}`, action: "service.created", entityType: "service", entityId: row!.id, data: { name: input.name } });
    return toItem(row!);
  });
}

export async function updateService(tenantId: string, userId: string, id: string, input: ServiceUpdateInput): Promise<ServiceItem> {
  return withTenant(tenantId, async (tx) => {
    const patch: Partial<ServiceRow> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.durationMins !== undefined) patch.durationMins = input.durationMins;
    if (input.priceDollars !== undefined) patch.priceCents = toCents(input.priceDollars);
    if (input.active !== undefined) patch.active = input.active;

    const [row] =
      Object.keys(patch).length > 0
        ? await tx.update(services).set(patch).where(eq(services.id, id)).returning()
        : await tx.select().from(services).where(eq(services.id, id));
    if (!row) throw notFound("Service");
    if (Object.keys(patch).length > 0) {
      await audit(tx, { tenantId, actor: `user:${userId}`, action: "service.updated", entityType: "service", entityId: id, data: { fields: Object.keys(input) } });
    }
    return toItem(row);
  });
}

/** Saves a new order; `ids` is the whole list, top first. */
export async function reorderServices(tenantId: string, ids: string[]): Promise<ServiceItem[]> {
  await withTenant(tenantId, async (tx) => {
    for (const [index, id] of ids.entries()) await tx.update(services).set({ sortOrder: index }).where(eq(services.id, id));
  });
  return listServices(tenantId);
}
