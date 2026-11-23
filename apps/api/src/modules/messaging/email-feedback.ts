import type { EmailFeedbackType } from "@leadanchor/contracts";
import { and, eq } from "drizzle-orm";
import { systemDb } from "../../db/client";
import { campaignRecipients, emailOptOuts, messages } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { HttpError, notFound } from "../../lib/errors";
import { audit } from "../compliance/audit";

/**
 * The email service reports back on a sent email (spec: "bounce and complaint handling"). A bounce
 * stops every email to that address; a spam complaint stops marketing to it, like an unsubscribe.
 * Either one is recorded on the campaign it came from. The provider's webhook (step 2) and the
 * Email outbox's development buttons both land here.
 */
export async function recordEmailFeedback(
  tenantId: string,
  messageId: string,
  type: EmailFeedbackType,
) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [message] = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.channel, "email"),
          eq(messages.direction, "outbound"),
        ),
      )
      .limit(1);
    if (!message) throw notFound("Email");
    if (message.feedback === type) return;
    if (message.feedback === "bounce")
      throw new HttpError(409, "bounced", "That email bounced, so it never reached anyone.");
    if (message.status !== "sent" && message.status !== "delivered")
      throw new HttpError(
        409,
        "not_sent",
        "That email wasn't sent, so the email service has nothing to report on it.",
      );

    const now = new Date();
    await tx
      .update(messages)
      .set({
        feedback: type,
        ...(type === "bounce" && {
          status: "failed",
          error: "Bounced: the address doesn't accept email.",
        }),
      })
      .where(eq(messages.id, message.id));

    const email = message.toAddress.trim().toLowerCase();
    const suppression = tx.insert(emailOptOuts).values({ tenantId, email, source: type });
    // A bounce outranks an unsubscribe: it stops job emails too.
    if (type === "bounce")
      await suppression.onConflictDoUpdate({
        target: [emailOptOuts.tenantId, emailOptOuts.email],
        set: { source: "bounce" },
      });
    else await suppression.onConflictDoNothing();

    await tx
      .update(campaignRecipients)
      .set(type === "bounce" ? { status: "bounced" } : { complainedAt: now })
      .where(eq(campaignRecipients.messageId, message.id));
    await audit(tx, {
      tenantId,
      actor: "system",
      action: type === "bounce" ? "email.bounced" : "email.complained",
      entityType: "message",
      entityId: message.id,
    });
    fx.publish({ type: "message.created", messageId: message.id, leadId: message.leadId });
  });
}

/**
 * The email service's report on one of our emails (Resend's webhook), found by the service's own
 * id for it: delivered, bounced or marked as spam. Reports can repeat or arrive late; each lands once.
 */
export async function applyEmailReport(
  providerMessageId: string,
  report: "delivered" | EmailFeedbackType,
) {
  const [message] = await systemDb
    .select({
      id: messages.id,
      tenantId: messages.tenantId,
      leadId: messages.leadId,
      status: messages.status,
    })
    .from(messages)
    .where(and(eq(messages.channel, "email"), eq(messages.providerMessageId, providerMessageId)))
    .limit(1);
  if (!message) return;
  if (report === "delivered") {
    if (message.status !== "sent") return;
    await tenantWork(message.tenantId, async (tx, fx) => {
      await tx
        .update(messages)
        .set({ status: "delivered", deliveredAt: new Date() })
        .where(and(eq(messages.id, message.id), eq(messages.status, "sent")));
      fx.publish({ type: "message.created", messageId: message.id, leadId: message.leadId });
    });
    return;
  }
  // Already recorded, or nothing to record (the email never went out): nothing more to do.
  await recordEmailFeedback(message.tenantId, message.id, report).catch((error: unknown) => {
    if (!(error instanceof HttpError)) throw error;
  });
}
