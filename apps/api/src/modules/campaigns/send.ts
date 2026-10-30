import { and, eq } from "drizzle-orm";
import { campaignRecipients, campaigns, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { randomToken, sha256 } from "../../lib/crypto";
import { audit } from "../compliance/audit";
import { requestEmail } from "../messaging/send-path";
import { notifyOwner } from "../notifications/notify";
import { firstNameOf } from "../reviews/reviews.service";
import { audienceLabel, resolveAudience } from "./audience";
import { emailFor } from "./campaign.service";
import { campaignLinkUrl } from "./links";
import { campaignHtml, campaignText } from "./render";

/** Sending is spread out: this many emails a minute (module 11: rate-limited sends). */
export const SENDS_PER_MINUTE = 60;

/**
 * Job: a scheduled campaign's time has come. The audience is worked out again now, everyone it
 * reaches or leaves out gets a row (the audit trail), and each email goes through the governed
 * send path with its own tracked link.
 */
export async function campaignSendJob({
  tenantId,
  campaignId,
}: {
  tenantId: string;
  campaignId: string;
}) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [campaign] = await tx
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .for("update");
    // Unscheduled, or moved later (a later job will come): nothing to do.
    if (!campaign || campaign.status !== "scheduled") return;
    if (campaign.scheduledFor && campaign.scheduledFor.getTime() > Date.now() + 60_000) return;
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) return;
    await tx.update(campaigns).set({ status: "sending" }).where(eq(campaigns.id, campaignId));

    const audience = await resolveAudience(tx, tenant, campaign.audience);
    for (const person of audience.leftOut) {
      await tx
        .insert(campaignRecipients)
        .values({
          tenantId,
          campaignId,
          customerId: person.customerId,
          email: person.email,
          name: person.name,
          status: "skipped",
          skipReason: person.reason,
          basis: person.basis,
        })
        .onConflictDoNothing();
    }

    let sent = 0;
    for (const person of audience.reachable) {
      const token = randomToken();
      const [recipient] = await tx
        .insert(campaignRecipients)
        .values({
          tenantId,
          campaignId,
          customerId: person.customerId,
          email: person.email,
          name: person.name,
          status: "sent",
          basis: person.basis,
          tokenHash: sha256(token),
        })
        .onConflictDoNothing()
        .returning({ id: campaignRecipients.id });
      if (!recipient) continue;
      const email = await emailFor(
        tenant,
        campaign,
        firstNameOf(person.name),
        campaignLinkUrl(token),
      );
      const message = await requestEmail(tx, fx, {
        tenant,
        customerId: person.customerId,
        leadId: null,
        to: person.email,
        subject: email.subject,
        body: campaignText(email),
        html: campaignHtml(email),
        purpose: "marketing",
        replyTo: campaign.replyTo,
        footer: { reason: person.reason, advertisement: true },
        sendAfterSecs: Math.floor(sent / SENDS_PER_MINUTE) * 60,
      });
      await tx
        .update(campaignRecipients)
        .set(
          message.status === "blocked"
            ? {
                status: "skipped",
                skipReason: message.blockedReason,
                tokenHash: null,
                messageId: message.id,
              }
            : { messageId: message.id, sentAt: new Date() },
        )
        .where(
          and(
            eq(campaignRecipients.id, recipient.id),
            eq(campaignRecipients.campaignId, campaignId),
          ),
        );
      if (message.status !== "blocked") sent += 1;
    }

    await tx
      .update(campaigns)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(campaigns.id, campaignId));
    await audit(tx, {
      tenantId,
      actor: "system",
      action: "campaign.sent",
      entityType: "campaign",
      entityId: campaignId,
      data: { audience: audienceLabel(campaign.audience), sent, leftOut: audience.leftOut.length },
    });
    await notifyOwner(tx, fx, {
      tenantId,
      kind: "campaign",
      title: `“${campaign.name}” is on its way`,
      body:
        sent > 0
          ? `Going to ${sent} ${sent === 1 ? "person" : "people"}. Taps and bookings show on the campaign as they come in.`
          : "Nobody on the list could get it by the time it went out. Open it to see why.",
      path: `/campaigns/${campaignId}`,
    });
  });
}
