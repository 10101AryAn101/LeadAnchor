import type { NotificationItem } from "@leadanchor/contracts";
import { and, desc, inArray, isNull, sql } from "drizzle-orm";
import { withTenant } from "../../db/client";
import { notifications } from "../../db/schema";

export async function listNotifications(tenantId: string): Promise<{ items: NotificationItem[]; unread: number }> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(40);
    const [count] = await tx.select({ unread: sql<number>`count(*)::int` }).from(notifications).where(isNull(notifications.readAt));
    return {
      items: rows.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        leadId: n.leadId,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      unread: count?.unread ?? 0,
    };
  });
}

export async function markNotificationsRead(tenantId: string, ids?: string[]) {
  await withTenant(tenantId, (tx) =>
    tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(ids?.length ? and(inArray(notifications.id, ids), isNull(notifications.readAt)) : isNull(notifications.readAt)),
  );
}
