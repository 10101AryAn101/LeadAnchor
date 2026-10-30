import type { EmailFeedbackType } from "@leadanchor/contracts";
import { and, eq } from "drizzle-orm";
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
