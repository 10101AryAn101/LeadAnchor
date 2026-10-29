import { and, eq } from "drizzle-orm";
import { withTenant } from "../../db/client";
import { phoneNumbers, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { QUEUES } from "../../jobs/queue";
import { HttpError, badRequest } from "../../lib/errors";
import { simulatorTelephony, telephony } from "../../container";
import { audit } from "../compliance/audit";

/** How long to wait for the test call to come back before calling it "not detected". */
const CHECK_WINDOW_SECS = 90;

/**
 * C-01 acceptance test: "forwarding active & verified by a test call". We ring the owner's
 * cell from their LeadAnchor number and wait for it to come back (see CallEngine.onIncoming).
 * On the simulator, `simulate` decides whether the pretend phone forwards.
 */
export async function startForwardingCheck(tenantId: string, userId: string, options: { simulate?: "forwards" | "no_forward" } = {}) {
  const { ownerCell, trackingNumber, ringSecs, running } = await withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [number] = await tx
      .select({ e164: phoneNumbers.e164 })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "active")))
      .limit(1);
    const startedAt = tenant?.forwardingCheckedAt?.getTime() ?? 0;
    return {
      ownerCell: tenant?.ownerCellE164 ?? null,
      trackingNumber: number?.e164 ?? null,
      ringSecs: (tenant?.ringTimeoutSecs ?? 18) + 25,
      running: tenant?.forwardingStatus === "checking" && Date.now() - startedAt < CHECK_WINDOW_SECS * 1000,
    };
  });
  if (!ownerCell) throw badRequest("Add your cell number in Settings first.");
  if (!trackingNumber) throw badRequest("This business has no LeadAnchor number yet.");
  // Two test calls at once would ring the owner twice and muddle the result.
  if (running) throw new HttpError(409, "check_running", "A test call is already ringing your cell. Give it a minute.");

  if (telephony === simulatorTelephony && options.simulate) simulatorTelephony.simulateForwarding(ownerCell, options.simulate === "forwards");

  const startedAt = new Date();
  await tenantWork(tenantId, async (tx, fx) => {
    await tx.update(tenants).set({ forwardingStatus: "checking", forwardingCheckedAt: startedAt }).where(eq(tenants.id, tenantId));
    await audit(tx, { tenantId, actor: `user:${userId}`, action: "forwarding.check_started", entityType: "tenant", entityId: tenantId });
    fx.publish({ type: "settings.updated" });
    fx.enqueue(QUEUES.forwardingCheckTimeout, { tenantId, startedAt: startedAt.toISOString() }, { startAfterSecs: CHECK_WINDOW_SECS });
    fx.afterCommit(() => telephony.placeTestCall({ from: trackingNumber, to: ownerCell, ringSecs }));
  });
}

/** Runs once the window has passed: if the call never came back, forwarding isn't on. */
export async function forwardingCheckTimeoutJob({ tenantId, startedAt }: { tenantId: string; startedAt: string }) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [tenant] = await tx.select({ status: tenants.forwardingStatus, checkedAt: tenants.forwardingCheckedAt }).from(tenants).where(eq(tenants.id, tenantId));
    // Only the check this job was queued for; a later one has its own timer.
    if (tenant?.status !== "checking" || tenant.checkedAt?.getTime() !== new Date(startedAt).getTime()) return;
    await tx.update(tenants).set({ forwardingStatus: "not_detected", forwardingCheckedAt: new Date() }).where(eq(tenants.id, tenantId));
    fx.publish({ type: "settings.updated" });
  });
}
