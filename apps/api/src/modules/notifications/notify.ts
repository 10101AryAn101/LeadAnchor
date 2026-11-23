import type { NotificationKind } from "@leadanchor/contracts";
import { eq } from "drizzle-orm";
import { linkBaseUrl } from "../../config/env";
import { systemDb, type Tx } from "../../db/client";
import { notifications } from "../../db/schema";
import type { Effects } from "../../db/unit-of-work";
import { sendPush } from "./push";

/**
 * Alerts the owner (C-05, C-40). The alert is stored and pushed to open screens
 * in real time; when Firebase Cloud Messaging is configured it is also sent as a
 * high-priority push after the transaction commits.
 */
export async function notifyOwner(
  tx: Tx,
  fx: Effects,
  input: {
    tenantId: string;
    kind: NotificationKind;
    title: string;
    body: string;
    leadId?: string | null;
    callbackPhone?: string | null;
    /** Where tapping the alert opens when it isn't about one job, e.g. "/reviews". */
    path?: string;
  },
) {
  const [row] = await tx
    .insert(notifications)
    .values({ tenantId: input.tenantId, kind: input.kind, title: input.title, body: input.body, leadId: input.leadId ?? null })
    .returning({ id: notifications.id });

  fx.publish({
    type: "notification.created",
    notificationId: row!.id,
    title: input.title,
    body: input.body,
    leadId: input.leadId ?? null,
  });

  fx.afterCommit(async () => {
    const link = input.leadId ? `${linkBaseUrl}/leads/${input.leadId}` : `${linkBaseUrl}${input.path ?? "/dashboard"}`;
    const status = await sendPush({
      tenantId: input.tenantId,
      title: input.title,
      body: input.body,
      link,
      callbackPhone: input.callbackPhone ?? null,
      tag: input.leadId ? `lead-${input.leadId}` : undefined,
    });
    if (status !== "in_app") {
      await systemDb.update(notifications).set({ pushStatus: status }).where(eq(notifications.id, row!.id));
    }
  });

  return row!.id;
}
