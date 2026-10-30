import {
  type AudiencePreview,
  type CampaignAudience,
  type CampaignDetail,
  type CampaignDraft,
  type CampaignKind,
  type CampaignOptions,
  type CampaignPreview,
  type CampaignStats,
  type CampaignSummary,
  type CampaignsResponse,
  campaignProblems,
  type campaignSendInput,
  type campaignUpdateInput,
  fillMergeFields,
} from "@leadanchor/contracts";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { linkBaseUrl } from "../../config/env";
import { ai } from "../../container";
import { type Tx, withTenant } from "../../db/client";
import {
  campaignRecipients,
  campaigns,
  customers,
  leads,
  services,
  tenants,
} from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { QUEUES } from "../../jobs/queue";
import { HttpError, notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { iso } from "../../lib/time";
import { localDate, zonedTime } from "../../lib/zoned";
import { settingsOf } from "../booking/core";
import { pricesAllowed } from "../chat/assistant";
import { audit } from "../compliance/audit";
import { marketingFooter, marketingFooterHtml, postalAddress } from "../messaging/email-opt-out";
import { requestEmail } from "../messaging/send-path";
import { publicBusinessOf } from "../payments/payment.service";
import { firstNameOf } from "../reviews/reviews.service";
import { audienceLabel, previewOf, resolveAudience } from "./audience";
import { type CopyContext, starterCopy } from "./copy";
import { destinationOf, friendlyDay } from "./links";
import { type CampaignEmail, campaignHtml, campaignText } from "./render";

type Campaign = typeof campaigns.$inferSelect;
type Tenant = typeof tenants.$inferSelect;

/** How far ahead a campaign can be scheduled. */
const MAX_SCHEDULE_DAYS = 60;

const DEFAULT_AUDIENCE: Record<CampaignKind, CampaignAudience> = {
  winback: { segment: "quiet", months: 6, service: null, tag: null },
  promotion: { segment: "customers", months: 6, service: null, tag: null },
  seasonal: { segment: "customers", months: 6, service: null, tag: null },
};

const EDITABLE: ReadonlySet<Campaign["status"]> = new Set(["draft", "suggested"]);

export const copyContextOf = (tenant: Tenant): CopyContext => ({
  business: tenant.name,
  ownerFirstName: firstNameOf(tenant.ownerName),
  trade: tenant.trade,
});

async function tenantOf(tx: Tx, tenantId: string) {
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw notFound("Business");
  return tenant;
}

async function campaignOf(tx: Tx, id: string, lock = false) {
  const query = tx
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), ne(campaigns.status, "canceled")));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw notFound("Campaign");
  return row;
}

/** One person's email: the copy with their first name in it, the offer, and their own tracked button. */
export async function emailFor(
  tenant: Tenant,
  campaign: Pick<Campaign, "subject" | "body" | "offer" | "offerEndsOn">,
  firstName: string | null,
  link: string,
): Promise<CampaignEmail> {
  const business = await publicBusinessOf(tenant);
  return {
    business: { name: tenant.name, phone: business.phone },
    subject: fillMergeFields(campaign.subject, firstName, "subject"),
    body: fillMergeFields(campaign.body, firstName, "body"),
    offer: campaign.offer,
    offerEnds: campaign.offerEndsOn ? friendlyDay(campaign.offerEndsOn) : null,
    button: { label: settingsOf(tenant).enabled ? "Book a time" : "Request a visit", url: link },
  };
}

/** What stops a campaign going out: its copy, a past end date, or no postal address (CAN-SPAM). */
function problemsOf(campaign: Campaign, tenant: Tenant, hasAddress: boolean) {
  const problems = campaignProblems(campaign);
  if (campaign.offerEndsOn && campaign.offerEndsOn < localDate(new Date(), tenant.timezone))
    problems.push("The offer's end date has passed. Change it or clear it.");
  if (!hasAddress)
    problems.push(
      "Add your street address and ZIP in Settings → Business profile. US anti-spam law requires it in every marketing email.",
    );
  return problems;
}

async function statsFor(tx: Tx, ids: string[]) {
  if (ids.length === 0) return new Map<string, CampaignStats>();
  const rows = await tx
    .select({
      id: campaignRecipients.campaignId,
      sent: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'sent')::int`,
      skipped: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'skipped')::int`,
      bounced: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'bounced')::int`,
      clicked: sql<number>`count(*) filter (where ${campaignRecipients.clickedAt} is not null)::int`,
      booked: sql<number>`count(*) filter (where ${campaignRecipients.bookedAt} is not null)::int`,
      unsubscribed: sql<number>`count(*) filter (where ${campaignRecipients.unsubscribedAt} is not null)::int`,
      complained: sql<number>`count(*) filter (where ${campaignRecipients.complainedAt} is not null)::int`,
      wonCents: sql<number>`coalesce(sum(${leads.valueCents}) filter (where ${leads.stage} = 'won'), 0)::int`,
    })
    .from(campaignRecipients)
    .leftJoin(leads, eq(leads.id, campaignRecipients.leadId))
    .where(inArray(campaignRecipients.campaignId, ids))
    .groupBy(campaignRecipients.campaignId);
  return new Map(rows.map(({ id, ...stats }) => [id, stats]));
}

const isOut = (row: Campaign) => row.status === "sending" || row.status === "sent";

function toSummary(row: Campaign, stats: CampaignStats | null): CampaignSummary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    name: row.name,
    audience: row.audience,
    audienceLabel: audienceLabel(row.audience),
    offer: row.offer,
    trigger: row.trigger ?? null,
    suggestedUntil: iso(row.suggestedUntil),
    scheduledFor: iso(row.scheduledFor),
    sentAt: iso(row.sentAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    stats,
  };
}

export async function listCampaigns(tenantId: string): Promise<CampaignsResponse> {
  return withTenant(tenantId, async (tx) => {
    const tenant = await tenantOf(tx, tenantId);
    const rows = (
      await tx
        .select()
        .from(campaigns)
        .where(ne(campaigns.status, "canceled"))
        .orderBy(desc(campaigns.createdAt))
        .limit(200)
    ).filter(
      (row) =>
        !(row.status === "suggested" && row.suggestedUntil && row.suggestedUntil < new Date()),
    );
    const stats = await statsFor(
      tx,
      rows.filter(isOut).map((row) => row.id),
    );
    const [withEmail] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(customers)
      .where(and(isNotNull(customers.email), ne(customers.email, "")));
    return {
      campaigns: rows.map((row) =>
        toSummary(row, stats.get(row.id) ?? (isOut(row) ? emptyStats() : null)),
      ),
      setup: {
        postalAddress: (await postalAddress(tx, tenant)) !== null,
        customersWithEmail: withEmail?.count ?? 0,
      },
    };
  });
}

const emptyStats = (): CampaignStats => ({
  sent: 0,
  skipped: 0,
  clicked: 0,
  booked: 0,
  wonCents: 0,
  unsubscribed: 0,
  bounced: 0,
  complained: 0,
});

export async function getCampaign(tenantId: string, id: string): Promise<CampaignDetail> {
  return withTenant(tenantId, async (tx) => {
    const tenant = await tenantOf(tx, tenantId);
    const row = await campaignOf(tx, id);
    const stats = isOut(row) ? ((await statsFor(tx, [row.id])).get(row.id) ?? emptyStats()) : null;
    const recipients = isOut(row)
      ? await tx
          .select()
          .from(campaignRecipients)
          .where(eq(campaignRecipients.campaignId, row.id))
          // Who booked, then who tapped, first; the rest by name.
          .orderBy(
            sql`${campaignRecipients.bookedAt} desc nulls last`,
            sql`${campaignRecipients.clickedAt} desc nulls last`,
            asc(campaignRecipients.status),
            asc(campaignRecipients.name),
          )
          .limit(1000)
      : [];
    return {
      ...toSummary(row, stats),
      subject: row.subject,
      body: row.body,
      offerEndsOn: row.offerEndsOn,
      serviceId: row.serviceId,
      approvedAt: iso(row.approvedAt),
      approvedBy: row.approvedBy,
      problems: EDITABLE.has(row.status)
        ? problemsOf(row, tenant, (await postalAddress(tx, tenant)) !== null)
        : [],
      recipients: recipients.map((recipient) => ({
        id: recipient.id,
        name: recipient.name ?? recipient.email ?? "Customer",
        email: recipient.email,
        status: recipient.status,
        skipReason: recipient.skipReason,
        sentAt: iso(recipient.sentAt),
        clickedAt: iso(recipient.clickedAt),
        bookedAt: iso(recipient.bookedAt),
        leadId: recipient.leadId,
        unsubscribedAt: iso(recipient.unsubscribedAt),
        complainedAt: iso(recipient.complainedAt),
      })),
      timezone: tenant.timezone,
      bookingOn: settingsOf(tenant).enabled,
    };
  });
}

/** A new draft, written for the business, going to the usual audience for its kind. */
export async function createCampaign(tenantId: string, kind: CampaignKind) {
  return tenantWork(tenantId, async (tx) => {
    const tenant = await tenantOf(tx, tenantId);
    const copy = starterCopy(kind, copyContextOf(tenant));
    const [row] = await tx
      .insert(campaigns)
      .values({
        tenantId,
        kind,
        status: "draft",
        name: copy.name,
        audience: DEFAULT_AUDIENCE[kind],
        subject: copy.subject,
        body: copy.body,
      })
      .returning({ id: campaigns.id });
    return { id: row!.id };
  });
}

export async function updateCampaign(
  tenantId: string,
  id: string,
  input: z.output<typeof campaignUpdateInput>,
) {
  await tenantWork(tenantId, async (tx) => {
    const row = await campaignOf(tx, id, true);
    if (!EDITABLE.has(row.status))
      throw new HttpError(
        409,
        "not_editable",
        row.status === "scheduled"
          ? "Cancel the schedule first, then change it."
          : "A sent campaign can't be changed.",
      );
    if (input.serviceId) {
      const [service] = await tx
        .select({ id: services.id })
        .from(services)
        .where(and(eq(services.id, input.serviceId), eq(services.active, true)));
      if (!service)
        throw new HttpError(422, "validation_failed", "Pick a service from your price list.", {
          serviceId: ["Pick a service"],
        });
    }
    await tx
      .update(campaigns)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.audience !== undefined && { audience: input.audience }),
        ...(input.subject !== undefined && { subject: input.subject }),
        ...(input.body !== undefined && { body: input.body }),
        ...(input.offer !== undefined && { offer: input.offer || null }),
        ...(input.offerEndsOn !== undefined && { offerEndsOn: input.offerEndsOn }),
        ...(input.serviceId !== undefined && { serviceId: input.serviceId }),
        // An edited suggestion is the owner's draft now, so it no longer lapses.
        status: "draft",
        suggestedUntil: null,
      })
      .where(eq(campaigns.id, id));
  });
  return getCampaign(tenantId, id);
}

/** Drafts are deleted; a suggestion is dismissed (and the same freeze or holiday isn't suggested again). */
export async function deleteCampaign(tenantId: string, id: string) {
  await tenantWork(tenantId, async (tx) => {
    const row = await campaignOf(tx, id, true);
    if (row.status === "draft") await tx.delete(campaigns).where(eq(campaigns.id, id));
    else if (row.status === "suggested")
      await tx
        .update(campaigns)
        .set({ status: "canceled", canceledAt: new Date() })
        .where(eq(campaigns.id, id));
    else if (row.status === "scheduled")
      throw new HttpError(409, "scheduled", "Cancel the schedule first.");
    else throw new HttpError(409, "sent", "A sent campaign stays as a record of who got it.");
  });
}

export async function previewAudience(
  tenantId: string,
  audience: CampaignAudience,
): Promise<AudiencePreview> {
  return withTenant(tenantId, async (tx) =>
    previewOf(await resolveAudience(tx, await tenantOf(tx, tenantId), audience)),
  );
}

/** The audience picker's choices: services done on finished jobs (and on the price list), and tags in use. */
export async function campaignOptions(tenantId: string): Promise<CampaignOptions> {
  return withTenant(tenantId, async (tx) => {
    const done = await tx
      .selectDistinct({ name: leads.serviceCategory })
      .from(leads)
      .where(and(eq(leads.stage, "won"), isNotNull(leads.serviceCategory)));
    const listed = await tx
      .select({ name: services.name })
      .from(services)
      .where(eq(services.active, true));
    const tags = (await tx.execute(sql`select distinct unnest(tags) as tag from leads order by 1`))
      .rows as Array<{ tag: string }>;
    const names = new Map<string, string>();
    for (const { name } of [...done, ...listed])
      if (name?.trim()) names.set(name.trim().toLowerCase(), name.trim());
    return {
      services: [...names.values()].sort((a, b) => a.localeCompare(b)),
      tags: tags.map((row) => row.tag).filter(Boolean),
    };
  });
}

/** The email as the first person on the list would get it, footer included. */
export async function previewCampaign(tenantId: string, id: string): Promise<CampaignPreview> {
  return withTenant(tenantId, async (tx) => {
    const tenant = await tenantOf(tx, tenantId);
    const row = await campaignOf(tx, id);
    const person = (await resolveAudience(tx, tenant, row.audience)).reachable[0] ?? null;
    const firstName = firstNameOf(person?.name);
    const email = await emailFor(tenant, row, firstName, destinationOf(tenant, row, null));
    const footer = {
      business: tenant.name,
      address: (await postalAddress(tx, tenant)) ?? "(your street address, city, state and ZIP)",
      unsubscribe: `${linkBaseUrl}/u/preview`,
      reason: person?.reason ?? `${tenant.name} did work for you`,
      advertisement: true,
    };
    return {
      subject: email.subject,
      html: campaignHtml(email).replace("<!--footer-->", marketingFooterHtml(footer)),
      text: campaignText(email) + marketingFooter(footer),
      sampleName: firstName,
    };
  });
}

/** A copy to the owner's own inbox, through the real send path. */
export async function sendTestEmail(
  tenantId: string,
  id: string,
  owner: { name: string; email: string },
) {
  return tenantWork(tenantId, async (tx, fx) => {
    const tenant = await tenantOf(tx, tenantId);
    const row = await campaignOf(tx, id);
    const problems = campaignProblems(row);
    if (problems.length > 0) throw new HttpError(422, "not_ready", problems[0]!);
    const email = await emailFor(
      tenant,
      row,
      firstNameOf(owner.name),
      destinationOf(tenant, row, null),
    );
    const message = await requestEmail(tx, fx, {
      tenant,
      customerId: null,
      leadId: null,
      to: owner.email,
      subject: `[Test] ${email.subject}`,
      body: campaignText(email),
      html: campaignHtml(email),
      purpose: "marketing",
      replyTo: owner.email,
      footer: { advertisement: true },
    });
    if (message.status === "blocked")
      throw new HttpError(409, "blocked", message.blockedReason ?? "That email couldn't be sent.");
    return { to: owner.email };
  });
}

/**
 * The owner's approval (C-30: nothing goes out without it). The audience is checked now and worked
 * out again at send time, so anyone who unsubscribes in between is left out.
 */
export async function approveCampaign(
  tenantId: string,
  id: string,
  input: z.output<typeof campaignSendInput>,
  owner: { userId: string; name: string; email: string },
) {
  await tenantWork(tenantId, async (tx, fx) => {
    const tenant = await tenantOf(tx, tenantId);
    const row = await campaignOf(tx, id, true);
    if (!EDITABLE.has(row.status))
      throw new HttpError(409, "not_draft", "This campaign is already scheduled or sent.");
    const problems = problemsOf(row, tenant, (await postalAddress(tx, tenant)) !== null);
    if (problems.length > 0) throw new HttpError(422, "not_ready", problems[0]!);
    const reachable = (await resolveAudience(tx, tenant, row.audience)).reachable.length;
    if (reachable === 0)
      throw new HttpError(
        422,
        "no_audience",
        "Nobody in this audience can get an email yet. Pick other customers.",
      );

    const now = Date.now();
    const sendAt =
      input.when === "now" ? new Date(now) : zonedTime(input.date, input.time, tenant.timezone);
    if (input.when === "later" && sendAt.getTime() < now + 60_000)
      throw new HttpError(422, "validation_failed", "Pick a time in the future.", {
        time: ["Pick a time in the future"],
      });
    if (sendAt.getTime() > now + MAX_SCHEDULE_DAYS * 86_400_000)
      throw new HttpError(
        422,
        "validation_failed",
        `Schedule it within ${MAX_SCHEDULE_DAYS} days.`,
        { date: ["Too far ahead"] },
      );

    await tx
      .update(campaigns)
      .set({
        status: "scheduled",
        scheduledFor: sendAt,
        approvedAt: new Date(now),
        approvedBy: owner.name,
        replyTo: owner.email,
        suggestedUntil: null,
      })
      .where(eq(campaigns.id, id));
    await audit(tx, {
      tenantId,
      actor: `user:${owner.userId}`,
      action: "campaign.approved",
      entityType: "campaign",
      entityId: id,
      data: { audience: audienceLabel(row.audience), reachable, sendAt: sendAt.toISOString() },
    });
    fx.enqueue(
      QUEUES.campaignSend,
      { tenantId, campaignId: id },
      { startAfterSecs: Math.max(0, Math.round((sendAt.getTime() - now) / 1000)) },
    );
  });
  return getCampaign(tenantId, id);
}

/** Back to a draft before it goes out; the queued send finds it no longer scheduled. */
export async function unscheduleCampaign(tenantId: string, id: string, owner: { userId: string }) {
  await tenantWork(tenantId, async (tx) => {
    const row = await campaignOf(tx, id, true);
    if (row.status !== "scheduled")
      throw new HttpError(
        409,
        "not_scheduled",
        row.status === "sent" || row.status === "sending"
          ? "It has already gone out."
          : "It isn't scheduled.",
      );
    await tx
      .update(campaigns)
      .set({ status: "draft", scheduledFor: null, approvedAt: null, approvedBy: null })
      .where(eq(campaigns.id, id));
    await audit(tx, {
      tenantId,
      actor: `user:${owner.userId}`,
      action: "campaign.unscheduled",
      entityType: "campaign",
      entityId: id,
    });
  });
  return getCampaign(tenantId, id);
}

/**
 * The AI writes the subject and message from the facts the owner set (module 11). Its words must
 * pass the same checks as the owner's, and mention no price but the offer's or the price list's;
 * otherwise, or when the AI is busy, a plain template stands in.
 */
export async function draftCampaignCopy(tenantId: string, id: string): Promise<CampaignDraft> {
  const { tenant, row, offered } = await withTenant(tenantId, async (tx) => ({
    tenant: await tenantOf(tx, tenantId),
    row: await campaignOf(tx, id),
    offered: await tx.select().from(services).where(eq(services.active, true)),
  }));
  const ctx = copyContextOf(tenant);
  const fallback = row.trigger
    ? { subject: row.subject, body: row.body }
    : starterCopy(row.kind, ctx);
  if (ai.configured) {
    try {
      const draft = await ai.draftCampaign({
        businessName: tenant.name,
        ownerFirstName: ctx.ownerFirstName,
        trade: tenant.trade,
        area: [tenant.city, tenant.state].filter(Boolean).join(", ") || null,
        kind: row.kind,
        audience: audienceLabel(row.audience),
        offer: row.offer,
        offerEnds: row.offerEndsOn ? friendlyDay(row.offerEndsOn) : null,
        service: offered.find((service) => service.id === row.serviceId)?.name ?? null,
        occasion: row.trigger ? `${row.trigger.title}. ${row.trigger.detail}` : null,
        timeoutMs: 25_000,
      });
      if (
        campaignProblems(draft).length === 0 &&
        pricesAllowed(`${draft.subject} ${draft.body}`, offered, row.offer)
      )
        return { ...draft, source: "ai" };
      logger.warn({ campaignId: id }, "AI campaign draft failed the checks; using the template");
    } catch (error) {
      logger.warn({ err: error, campaignId: id }, "AI campaign draft failed; using the template");
    }
  }
  return { ...fallback, source: "template" };
}
