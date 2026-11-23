import { DEFAULT_SEND_RATE } from "@leadanchor/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { campaignRecipients, campaigns, customers, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { randomToken, sha256 } from "../../lib/crypto";
import { featureOn } from "../billing/access";
import { audit } from "../compliance/audit";
import { requestEmail } from "../messaging/send-path";
import { notifyOwner } from "../notifications/notify";
import { firstNameOf } from "../reviews/reviews.service";
import { audienceLabel, resolveAudience } from "./audience";
import { emailFor } from "./campaign.service";
import { campaignLinkUrl } from "./links";
import { quietUntil, recipientZone } from "./quiet-hours";
import { campaignHtml, campaignText } from "./render";

/**
 * Sending is spread out (module 11: rate-limited sends) at the rate the owner approved with the
 * campaign (C-44 AC 5); campaigns approved before that choice existed go at this rate.
 */
export const SENDS_PER_MINUTE = DEFAULT_SEND_RATE;

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
    // Scheduled while the plan covered campaigns, but it no longer does (say the trial ended):
    // back to a draft, and the owner hears why.
    if (!featureOn(tenant, "campaigns")) {
      await tx
        .update(campaigns)
        .set({
          status: "draft",
          scheduledFor: null,
          approvedAt: null,
          approvedBy: null,
          sendsPerMinute: null,
        })
        .where(eq(campaigns.id, campaignId));
      await audit(tx, {
        tenantId,
        actor: "system",
        action: "campaign.unscheduled",
        entityType: "campaign",
        entityId: campaignId,
        data: { reason: "plan" },
      });
      await notifyOwner(tx, fx, {
        tenantId,
        kind: "campaign",
        title: `“${campaign.name}” wasn't sent`,
        body: "Campaigns are part of Pro, and your plan doesn't include them right now. Choose a plan in Settings, then send it again.",
        path: `/campaigns/${campaignId}`,
      });
      return;
    }
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

    // C-44 AC 4: each email waits out the recipient's own quiet hours (9 pm to 8 am their time).
    const addresses = new Map(
      audience.reachable.length === 0
        ? []
        : (
            await tx
              .select({ id: customers.id, address: customers.address })
              .from(customers)
              .where(
                inArray(
                  customers.id,
                  audience.reachable.map((person) => person.customerId),
                ),
              )
          ).map((row) => [row.id, row.address]),
    );
    const perMinute = campaign.sendsPerMinute ?? SENDS_PER_MINUTE;
    const start = Date.now();
    let sent = 0;
    let heldForMorning = 0;
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
      const due = new Date(start + Math.floor(sent / perMinute) * 60_000);
      const morning = quietUntil(
        due,
        recipientZone(addresses.get(person.customerId), tenant.timezone),
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
        sendAfterSecs: Math.max(0, Math.round(((morning ?? due).getTime() - start) / 1000)),
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
      if (message.status !== "blocked") {
        sent += 1;
        if (morning) heldForMorning += 1;
      }
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
      data: {
        audience: audienceLabel(campaign.audience),
        sent,
        leftOut: audience.leftOut.length,
        perMinute,
        heldForMorning,
      },
    });
    await notifyOwner(tx, fx, {
      tenantId,
      kind: "campaign",
      title: `“${campaign.name}” is on its way`,
      body:
        sent > 0
          ? `Going to ${sent} ${sent === 1 ? "person" : "people"}.${heldForMorning > 0 ? ` ${heldForMorning} of them ${heldForMorning === 1 ? "gets" : "get"} it at 8 am their time, after quiet hours.` : ""} Taps and bookings show on the campaign as they come in.`
          : "Nobody on the list could get it by the time it went out. Open it to see why.",
      path: `/campaigns/${campaignId}`,
    });
  });
}
