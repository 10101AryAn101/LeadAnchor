import { eq } from "drizzle-orm";
import { messages } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { withTenant } from "../../db/client";
import { logger } from "../../lib/logger";
import { channels } from "../../container";

/** Job handler: delivers one queued message through its channel adapter. */
export async function dispatchMessage({ tenantId, messageId }: { tenantId: string; messageId: string }) {
  const message = await withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    return row ?? null;
  });
  if (!message || message.status !== "queued") return;

  const adapter =
    message.channel === "whatsapp"
      ? channels.whatsapp
      : message.channel === "email"
        ? channels.email
        : message.channel === "web"
          ? channels.web
          : channels.sms;
  if (!adapter) {
    await markFailed(tenantId, messageId, message.leadId, `No ${message.channel} adapter is configured.`);
    return;
  }

  try {
    const result = await adapter.send({
      id: message.id,
      from: message.fromAddress,
      to: message.toAddress,
      subject: message.subject,
      body: message.body,
      html: message.html,
      replyTo: message.replyTo,
    });
    await tenantWork(tenantId, async (tx, fx) => {
      const now = new Date();
      await tx
        .update(messages)
        .set({
          status: result.delivered ? "delivered" : "sent",
          providerMessageId: result.providerMessageId,
          sentAt: now,
          deliveredAt: result.delivered ? now : null,
        })
        .where(eq(messages.id, messageId));
      fx.publish({ type: "message.created", messageId, leadId: message.leadId });
    });
  } catch (error) {
    logger.error({ err: error, messageId }, "message dispatch failed");
    await markFailed(tenantId, messageId, message.leadId, (error as Error).message);
    throw error; // let the queue retry
  }
}

async function markFailed(tenantId: string, messageId: string, leadId: string | null, reason: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    await tx.update(messages).set({ status: "failed", error: reason }).where(eq(messages.id, messageId));
    fx.publish({ type: "message.created", messageId, leadId });
  });
}
