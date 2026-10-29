import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { auditLog } from "../../db/schema";
import { sha256 } from "../../lib/crypto";

export interface AuditEntry {
  tenantId: string;
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
}

/**
 * Appends to the tenant's hash-chained audit trail. Each row stores the hash of
 * the previous row, so any later edit or deletion breaks the chain and is detectable.
 */
export async function audit(tx: Tx, entry: AuditEntry) {
  // Serialise writers per tenant so the chain stays linear.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`audit:${entry.tenantId}`}))`);

  const [last] = await tx
    .select({ hash: auditLog.hash })
    .from(auditLog)
    .where(eq(auditLog.tenantId, entry.tenantId))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(1);

  const createdAt = new Date();
  const data = entry.data ?? {};
  const prevHash = last?.hash ?? null;
  const hash = sha256(
    JSON.stringify([prevHash, entry.tenantId, entry.actor, entry.action, entry.entityType, entry.entityId ?? null, data, createdAt.toISOString()]),
  );

  await tx.insert(auditLog).values({
    tenantId: entry.tenantId,
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    data,
    prevHash,
    hash,
    createdAt,
  });
}
