import { LEAD_STAGES, type LeadSource, type LeadStage, URGENCY_LEVELS, type Urgency } from "@leadanchor/contracts";
import { and, desc, eq, gt, inArray, min } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { leadEvents, leads, type tenants } from "../../db/schema";
import type { Effects } from "../../db/unit-of-work";
import { upsertCustomerByPhone } from "../customers/customer.repo";

type Tenant = typeof tenants.$inferSelect;
export type Lead = typeof leads.$inferSelect;

export const OPEN_STAGES = LEAD_STAGES.filter((stage): stage is LeadStage => stage !== "won" && stage !== "lost");

/** Repeat contacts within this window join the existing open lead instead of creating a duplicate (C-04). */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Position that puts a card at the top of its column. */
export async function topPosition(tx: Tx, tenantId: string, stage: LeadStage) {
  const [row] = await tx
    .select({ value: min(leads.position) })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.stage, stage)));
  return (row?.value ?? 1) - 1;
}

export async function addLeadEvent(
  tx: Tx,
  input: { tenantId: string; leadId: string; type: string; actor?: string; data?: Record<string, unknown> },
) {
  await tx.insert(leadEvents).values({
    tenantId: input.tenantId,
    leadId: input.leadId,
    type: input.type,
    actor: input.actor ?? "system",
    data: input.data ?? {},
  });
  await tx.update(leads).set({ lastActivityAt: new Date() }).where(eq(leads.id, input.leadId));
}

export const higherUrgency = (a: Urgency, b: Urgency): Urgency =>
  URGENCY_LEVELS.indexOf(a) >= URGENCY_LEVELS.indexOf(b) ? a : b;

export interface CaptureInput {
  tenant: Tenant;
  phoneE164: string;
  customerName?: string | null;
  source: LeadSource;
  title: string;
  summary?: string | null;
  needsCallback: boolean;
  event: { type: string; data?: Record<string, unknown> };
}

/**
 * Turns a captured contact into a lead card. A repeat contact from the same
 * customer within 24 hours updates their open card rather than adding a new one.
 */
export async function captureLead(tx: Tx, fx: Effects, input: CaptureInput): Promise<{ lead: Lead; created: boolean }> {
  const customer = await upsertCustomerByPhone(tx, input.tenant.id, input.phoneE164, { name: input.customerName ?? null });

  const [open] = await tx
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, input.tenant.id),
        eq(leads.customerId, customer.id),
        inArray(leads.stage, OPEN_STAGES),
        gt(leads.lastActivityAt, new Date(Date.now() - DEDUPE_WINDOW_MS)),
      ),
    )
    .orderBy(desc(leads.lastActivityAt))
    .limit(1);

  if (open) {
    const [updated] = await tx
      .update(leads)
      .set({
        needsCallback: open.needsCallback || input.needsCallback,
        summary: open.summary ?? input.summary ?? null,
        lastActivityAt: new Date(),
      })
      .where(eq(leads.id, open.id))
      .returning();
    await addLeadEvent(tx, { tenantId: input.tenant.id, leadId: open.id, type: input.event.type, data: { ...input.event.data, repeatContact: true } });
    fx.publish({ type: "lead.updated", leadId: open.id });
    return { lead: updated!, created: false };
  }

  const [lead] = await tx
    .insert(leads)
    .values({
      tenantId: input.tenant.id,
      customerId: customer.id,
      source: input.source,
      title: input.title,
      summary: input.summary ?? null,
      needsCallback: input.needsCallback,
      estimatedValueCents: input.tenant.avgJobValueCents,
      position: await topPosition(tx, input.tenant.id, "new"),
    })
    .returning();

  await addLeadEvent(tx, { tenantId: input.tenant.id, leadId: lead!.id, type: input.event.type, data: input.event.data });
  fx.publish({ type: "lead.created", leadId: lead!.id });
  return { lead: lead!, created: true };
}
