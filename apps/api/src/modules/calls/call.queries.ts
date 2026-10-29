import type { CallItem } from "@leadanchor/contracts";
import { asc, desc, eq } from "drizzle-orm";
import { withTenant } from "../../db/client";
import { callEvents, calls, customers } from "../../db/schema";
import { notFound } from "../../lib/errors";
import { toCallItem } from "../leads/lead.service";

export async function listCalls(tenantId: string, limit = 100): Promise<CallItem[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ call: calls, customer: customers })
      .from(calls)
      .leftJoin(customers, eq(customers.id, calls.customerId))
      .orderBy(desc(calls.startedAt))
      .limit(limit);
    return rows.map(({ call, customer }) => toCallItem(call, customer));
  });
}

/** One call with its step-by-step trace (used by the simulator's live view). */
export async function getCallTrace(tenantId: string, where: { id?: string; sessionId?: string }) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ call: calls, customer: customers })
      .from(calls)
      .leftJoin(customers, eq(customers.id, calls.customerId))
      .where(where.id ? eq(calls.id, where.id) : eq(calls.providerSessionId, where.sessionId ?? ""))
      .limit(1);
    if (!row) throw notFound("Call");
    const events = await tx.select().from(callEvents).where(eq(callEvents.callId, row.call.id)).orderBy(asc(callEvents.occurredAt));
    return {
      call: { ...toCallItem(row.call, row.customer), state: row.call.state },
      events: events.map((e) => ({ id: e.id, type: e.type, data: e.data, occurredAt: e.occurredAt.toISOString() })),
    };
  });
}
