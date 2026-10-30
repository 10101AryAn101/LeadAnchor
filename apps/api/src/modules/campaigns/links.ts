import type { PublicCampaignOffer } from "@leadanchor/contracts";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { linkBaseUrl } from "../../config/env";
import { type Tx, systemDb } from "../../db/client";
import { campaignRecipients, campaigns, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { sha256 } from "../../lib/crypto";
import { notFound } from "../../lib/errors";
import { localDate } from "../../lib/zoned";
import { bookingUrl, settingsOf } from "../booking/core";
import { addLeadEvent } from "../leads/lead-capture";
import { publicBusinessOf } from "../payments/payment.service";

type Tenant = typeof tenants.$inferSelect;
type Campaign = typeof campaigns.$inferSelect;

/** The tracked link in a campaign email: one per person, so a tap or a booking is credited (module 11). */
export const campaignLinkUrl = (token: string) => `${linkBaseUrl}/o/${token}`;

/** Where the button leads: the booking page, opened on the offer's service, or the request form. */
export function destinationOf(
  tenant: Tenant,
  campaign: Pick<Campaign, "serviceId">,
  token: string | null,
) {
  if (settingsOf(tenant).enabled) {
    const params = new URLSearchParams({ src: "link" });
    if (campaign.serviceId) params.set("service", campaign.serviceId);
    if (token) params.set("campaign", token);
    return `${bookingUrl(tenant.slug)}?${params}`;
  }
  // The request form (intake's requestUrl, spelled out here so the two modules don't import each other).
  return `${linkBaseUrl}/r/${tenant.slug}?src=link${token ? `&campaign=${token}` : ""}`;
}

/** "Sunday, November 30" */
export const friendlyDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

export const offerEnded = (
  campaign: Pick<Campaign, "offerEndsOn">,
  tenant: Pick<Tenant, "timezone">,
) => Boolean(campaign.offerEndsOn && campaign.offerEndsOn < localDate(new Date(), tenant.timezone));

async function byToken(token: string) {
  const [row] = await systemDb
    .select({ recipient: campaignRecipients, campaign: campaigns, tenant: tenants })
    .from(campaignRecipients)
    .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
    .innerJoin(tenants, eq(tenants.id, campaignRecipients.tenantId))
    .where(eq(campaignRecipients.tokenHash, sha256(token)))
    .limit(1);
  if (!row || row.tenant.status === "cancelled" || row.tenant.status === "suspended")
    throw notFound("Link");
  return row;
}

/** Someone tapped the button: count it and say where to send them. */
export async function openCampaignLink(token: string) {
  const { recipient, campaign, tenant } = await byToken(token);
  await tenantWork(tenant.id, async (tx) => {
    await tx
      .update(campaignRecipients)
      .set({ clicks: recipient.clicks + 1, ...(!recipient.clickedAt && { clickedAt: new Date() }) })
      .where(eq(campaignRecipients.id, recipient.id));
  });
  return { url: destinationOf(tenant, campaign, token) };
}

/** The offer, for the booking page they land on (C-44). */
export async function getCampaignOffer(token: string): Promise<PublicCampaignOffer> {
  const { campaign, tenant } = await byToken(token);
  return {
    business: await publicBusinessOf(tenant),
    offer: campaign.offer,
    endsOn: campaign.offerEndsOn ? friendlyDay(campaign.offerEndsOn) : null,
    ended: offerEnded(campaign, tenant),
    serviceId: campaign.serviceId,
  };
}

/**
 * C-44: a booking or request made from a campaign link is credited to the campaign, and the job
 * says which offer it came with, so the owner honours it.
 */
export async function creditCampaign(
  tx: Tx,
  input: { tenant: Tenant; token: string; leadId: string; via: "booking" | "request" },
) {
  const [row] = await tx
    .select({ recipient: campaignRecipients, campaign: campaigns })
    .from(campaignRecipients)
    .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
    .where(eq(campaignRecipients.tokenHash, sha256(input.token)))
    .limit(1);
  if (!row) return;
  if (!row.recipient.bookedAt) {
    await tx
      .update(campaignRecipients)
      .set({ bookedAt: new Date(), leadId: input.leadId })
      .where(eq(campaignRecipients.id, row.recipient.id));
  }
  await addLeadEvent(tx, {
    tenantId: input.tenant.id,
    leadId: input.leadId,
    type: "campaign.responded",
    actor: "customer",
    data: {
      campaignId: row.campaign.id,
      campaign: row.campaign.name,
      offer: row.campaign.offer,
      ended: offerEnded(row.campaign, input.tenant),
      via: input.via,
    },
  });
}

/** An unsubscribe counts against the campaign that prompted it: their latest in the last two months. */
export async function creditUnsubscribe(tx: Tx, email: string) {
  const [latest] = await tx
    .select({ id: campaignRecipients.id })
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.email, email.trim().toLowerCase()),
        eq(campaignRecipients.status, "sent"),
        isNull(campaignRecipients.unsubscribedAt),
        gt(campaignRecipients.createdAt, new Date(Date.now() - 60 * 86_400_000)),
      ),
    )
    .orderBy(desc(campaignRecipients.createdAt))
    .limit(1);
  if (latest)
    await tx
      .update(campaignRecipients)
      .set({ unsubscribedAt: new Date() })
      .where(eq(campaignRecipients.id, latest.id));
}
