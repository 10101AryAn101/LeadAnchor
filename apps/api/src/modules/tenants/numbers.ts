import { formatPhone } from "@leadanchor/contracts";
import { and, eq } from "drizzle-orm";
import { telephony } from "../../container";
import { systemDb } from "../../db/client";
import { phoneNumbers, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { logger } from "../../lib/logger";
import { audit } from "../compliance/audit";
import { notifyOwner } from "../notifications/notify";

import { NUMBER_GRACE_DAYS, numberReleaseDue } from "./number-rule";

export { NUMBER_GRACE_DAYS, numberReleaseDue };

/**
 * Daily: numbers of businesses that left go back to the carrier, so they stop costing money and
 * nobody's calls reach a business that has closed its account. Each release is audited.
 */
export async function releaseLeftNumbers(now = new Date()) {
  const rows = await systemDb
    .select({ number: phoneNumbers, tenant: tenants })
    .from(phoneNumbers)
    .innerJoin(tenants, eq(tenants.id, phoneNumbers.tenantId))
    .where(and(eq(phoneNumbers.status, "active"), eq(tenants.status, "cancelled")));
  let released = 0;
  for (const { number, tenant } of rows) {
    if (!numberReleaseDue(tenant, now)) continue;
    try {
      // Only the carrier that holds a number can take it back; a simulated one is just let go.
      if (number.provider !== "simulator") {
        if (number.provider !== telephony.name) {
          logger.warn({ number: number.e164 }, "number held by another carrier: not released");
          continue;
        }
        await telephony.releaseNumber({
          e164: number.e164,
          providerNumberId: number.providerNumberId,
        });
      }
      await tenantWork(tenant.id, async (tx) => {
        await tx
          .update(phoneNumbers)
          .set({ status: "released" })
          .where(eq(phoneNumbers.id, number.id));
        await audit(tx, {
          tenantId: tenant.id,
          actor: "system",
          action: "number.released",
          entityType: "phone_number",
          entityId: number.id,
          data: { e164: number.e164, reason: "account_closed", graceDays: NUMBER_GRACE_DAYS },
        });
      });
      released += 1;
    } catch (error) {
      logger.warn(
        { err: error, number: number.e164 },
        "number release failed; tried again tomorrow",
      );
    }
  }
  if (released > 0) logger.info({ released }, "numbers released for closed accounts");
  return { released };
}

/**
 * A business that comes back after its number was released gets a new one, from its owner's
 * area code, and is told the new number (its old one may belong to someone else by now).
 */
export async function ensureNumber(tenantId: string) {
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant || tenant.status === "cancelled") return;
  const [active] = await systemDb
    .select({ id: phoneNumbers.id })
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "active")))
    .limit(1);
  if (active) return;
  const number = await telephony.provisionNumber({
    areaCode: tenant.ownerCellE164?.slice(2, 5) ?? null,
    state: tenant.state,
  });
  await tenantWork(tenantId, async (tx, fx) => {
    await tx.insert(phoneNumbers).values({
      tenantId,
      e164: number.e164,
      provider: telephony.name,
      providerNumberId: number.providerNumberId,
    });
    await audit(tx, {
      tenantId,
      actor: "system",
      action: "number.provisioned",
      entityType: "tenant",
      entityId: tenantId,
      data: { e164: number.e164, reason: "account_reopened" },
    });
    await notifyOwner(tx, fx, {
      tenantId,
      kind: "account",
      title: "Welcome back: you have a new LeadAnchor number",
      body: `Your old number was released while your account was closed. Your new line is ${formatPhone(number.e164)}. Update your call forwarding to it.`,
      path: "/settings",
    });
  });
}
