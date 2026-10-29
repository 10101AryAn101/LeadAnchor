import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { customers } from "../../db/schema";

export type Customer = typeof customers.$inferSelect;

export async function findCustomerByPhone(tx: Tx, tenantId: string, phoneE164: string) {
  const [row] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.phoneE164, phoneE164)))
    .limit(1);
  return row ?? null;
}

/**
 * Creates or refreshes the customer for a phone number (Customer MDM, C-04).
 * Never overwrites a name or address the owner already has.
 */
export async function upsertCustomerByPhone(
  tx: Tx,
  tenantId: string,
  phoneE164: string,
  patch: { name?: string | null; address?: string | null; email?: string | null } = {},
): Promise<Customer> {
  const now = new Date();
  const [row] = await tx
    .insert(customers)
    .values({
      tenantId,
      phoneE164,
      name: patch.name ?? null,
      address: patch.address ?? null,
      email: patch.email ?? null,
      firstSeenAt: now,
      lastContactAt: now,
    })
    .onConflictDoUpdate({
      target: [customers.tenantId, customers.phoneE164],
      set: {
        lastContactAt: now,
        name: sql`coalesce(${customers.name}, excluded.name)`,
        address: sql`coalesce(${customers.address}, excluded.address)`,
        email: sql`coalesce(${customers.email}, excluded.email)`,
      },
    })
    .returning();
  return row!;
}
