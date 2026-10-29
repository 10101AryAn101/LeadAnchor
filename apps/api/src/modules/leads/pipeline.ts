import { type AutoMoveReason, type LeadStage, autoMoveTarget } from "@leadanchor/contracts";
import { eq } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { leads } from "../../db/schema";
import type { Effects } from "../../db/unit-of-work";
import { addLeadEvent, topPosition } from "./lead-capture";

/** Reasons that mean the owner reached the customer, so nobody is waiting on a call back any more. */
const REACHED_OUT: ReadonlySet<AutoMoveReason> = new Set(["owner_called", "owner_texted", "owner_answered", "form_sent"]);

/**
 * Moves a card forward by itself when the owner does something that shows where the
 * job is: reaching the customer (Contacted), adding a price (Quoted) or booking a visit
 * (Scheduled). Cards only move forward and never into Won or Lost, so a stage the owner
 * picked by hand is never undone. Each move goes on the lead's timeline with its reason.
 */
export async function advanceLead(
  tx: Tx,
  fx: Effects,
  input: { tenantId: string; leadId: string; reason: AutoMoveReason },
): Promise<{ from: LeadStage; to: LeadStage } | null> {
  const [lead] = await tx
    .select({ stage: leads.stage, needsCallback: leads.needsCallback })
    .from(leads)
    .where(eq(leads.id, input.leadId))
    .for("update");
  if (!lead) return null;

  const to = autoMoveTarget(lead.stage, input.reason);
  if (!to) {
    if (lead.needsCallback && REACHED_OUT.has(input.reason)) {
      await tx.update(leads).set({ needsCallback: false }).where(eq(leads.id, input.leadId));
      fx.publish({ type: "lead.updated", leadId: input.leadId });
    }
    return null;
  }

  await tx
    .update(leads)
    .set({ stage: to, stageChangedAt: new Date(), needsCallback: false, position: await topPosition(tx, input.tenantId, to) })
    .where(eq(leads.id, input.leadId));
  await addLeadEvent(tx, {
    tenantId: input.tenantId,
    leadId: input.leadId,
    type: "stage.changed",
    data: { from: lead.stage, to, auto: true, reason: input.reason },
  });
  fx.publish({ type: "lead.updated", leadId: input.leadId });
  return { from: lead.stage, to };
}
