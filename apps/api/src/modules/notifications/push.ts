import type { PushDevice, PushDeviceInput, PushDevicesResponse, PushStatus } from "@leadanchor/contracts";
import { and, asc, eq, inArray } from "drizzle-orm";
import { linkBaseUrl } from "../../config/env";
import { systemDb, withTenant } from "../../db/client";
import { pushDevices } from "../../db/schema";
import { randomToken } from "../../lib/crypto";
import { badRequest, notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { iso } from "../../lib/time";
import { push } from "../../container";
import type { PushMessage } from "../../integrations/push/types";

/**
 * Sends one alert to the phones that turned alerts on (C-05). Never throws: every
 * alert is also in the app, so a push problem must not undo the work that raised it.
 */
export async function sendPush(message: PushMessage, options: { deviceId?: string } = {}): Promise<PushStatus> {
  try {
    const devices = await withTenant(message.tenantId, (tx) =>
      tx
        .select({ id: pushDevices.id, token: pushDevices.token })
        .from(pushDevices)
        .where(and(eq(pushDevices.provider, push.name), options.deviceId ? eq(pushDevices.id, options.deviceId) : undefined)),
    );
    if (devices.length === 0) return "in_app";

    const result = await push.send(
      message,
      devices.map((device) => device.token),
    );
    await withTenant(message.tenantId, async (tx) => {
      if (result.invalidTokens.length > 0) await tx.delete(pushDevices).where(inArray(pushDevices.token, result.invalidTokens));
      if (result.status !== "fcm_failed") {
        await tx.update(pushDevices).set({ lastAlertAt: new Date() }).where(inArray(pushDevices.id, devices.map((device) => device.id)));
      }
    });
    return result.status;
  } catch (error) {
    logger.warn({ err: error, tenantId: message.tenantId }, "push failed");
    return push.name === "fcm" ? "fcm_failed" : "in_app";
  }
}

export async function listPushDevices(tenantId: string): Promise<PushDevicesResponse> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(pushDevices).where(eq(pushDevices.provider, push.name)).orderBy(asc(pushDevices.createdAt)),
  );
  return { provider: push.name, devices: rows.map(present) };
}

/** Turns alerts on for one browser. Re-enabling the same browser keeps a single row. */
export async function addPushDevice(tenantId: string, userId: string, input: PushDeviceInput): Promise<PushDevice> {
  if (push.name === "fcm" && !input.token) throw badRequest("This browser didn't get a push token. Try again.");
  // The simulator issues its own tokens; a browser re-enabling alerts sends its old one back.
  const token = push.name === "fcm" ? input.token! : input.token?.startsWith("sim-") ? input.token : `sim-${randomToken(12)}`;

  // A token belongs to one browser: if it was registered before (even for another business), move it here.
  await systemDb.delete(pushDevices).where(eq(pushDevices.token, token));
  const [row] = await withTenant(tenantId, (tx) =>
    tx.insert(pushDevices).values({ tenantId, userId, provider: push.name, token, label: input.label }).returning(),
  );
  return present(row!);
}

export async function removePushDevice(tenantId: string, id: string) {
  const removed = await withTenant(tenantId, (tx) => tx.delete(pushDevices).where(eq(pushDevices.id, id)).returning({ id: pushDevices.id }));
  if (removed.length === 0) throw notFound("Phone");
}

/** Shows the owner what a missed-call alert looks like on one phone. */
export async function sendTestAlert(tenantId: string, deviceId: string) {
  const status = await sendPush(
    {
      tenantId,
      title: "Test alert from LeadAnchor",
      body: "Missed calls show up like this. Tap an alert to open the lead, or tap Call back to ring them.",
      link: `${linkBaseUrl}/dashboard`,
      callbackPhone: null,
      tag: "test",
    },
    { deviceId },
  );
  if (status === "in_app") throw notFound("Phone");
  return status;
}

function present(row: typeof pushDevices.$inferSelect): PushDevice {
  return { id: row.id, label: row.label, token: row.token, createdAt: row.createdAt.toISOString(), lastAlertAt: iso(row.lastAlertAt) };
}
