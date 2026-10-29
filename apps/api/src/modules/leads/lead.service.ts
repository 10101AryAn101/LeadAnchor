import {
  type CallItem,
  type ContactChannel,
  type LeadCard,
  type LeadContactResult,
  type LeadDetail,
  type LeadUpdateInput,
  type MediaItem,
  type MessageItem,
} from "@leadanchor/contracts";
import { and, asc, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { calls, customers, leadEvents, leads, mediaAssets, messages, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { withTenant } from "../../db/client";
import { notFound } from "../../lib/errors";
import { iso, isoOrNow } from "../../lib/time";
import { createIntakeLink } from "../intake/intake.service";
import { requestMessage } from "../messaging/send-path";
import { profileLine } from "../profile/profile";
import { addLeadEvent, topPosition } from "./lead-capture";
import { advanceLead } from "./pipeline";

type LeadRow = typeof leads.$inferSelect;
type CustomerRow = typeof customers.$inferSelect;

/** Closed cards older than this drop off the board (they stay in history). */
const CLOSED_VISIBLE_DAYS = 30;

/** Repeated taps on Call or Text within this window count as one attempt on the timeline. */
const REPEAT_TAP_MS = 2 * 60 * 1000;

function toCard(lead: LeadRow, customer: CustomerRow, photos: { count: number; coverId: string | null }, returning: boolean): LeadCard {
  return {
    id: lead.id,
    stage: lead.stage,
    source: lead.source,
    title: lead.title,
    summary: lead.summary,
    urgency: lead.urgency,
    serviceCategory: lead.serviceCategory,
    customer: { id: customer.id, name: customer.name, phone: customer.phoneE164, isReturning: returning },
    valueCents: lead.valueCents,
    estimatedValueCents: lead.estimatedValueCents,
    needsCallback: lead.needsCallback,
    intakeStatus: lead.intakeStatus,
    scheduledFor: iso(lead.scheduledFor),
    photoCount: photos.count,
    coverPhotoId: photos.coverId,
    position: lead.position,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    lastActivityAt: lead.lastActivityAt.toISOString(),
  };
}

async function photoStats(tx: Tx, leadIds: string[]) {
  const map = new Map<string, { count: number; coverId: string | null }>();
  if (leadIds.length === 0) return map;
  const rows = await tx
    .select({ leadId: mediaAssets.leadId, id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(inArray(mediaAssets.leadId, leadIds), eq(mediaAssets.kind, "photo")))
    .orderBy(asc(mediaAssets.createdAt));
  for (const row of rows) {
    if (!row.leadId) continue;
    const entry = map.get(row.leadId) ?? { count: 0, coverId: row.id };
    entry.count += 1;
    map.set(row.leadId, entry);
  }
  return map;
}

async function leadCountsByCustomer(tx: Tx, customerIds: string[]) {
  const map = new Map<string, number>();
  if (customerIds.length === 0) return map;
  const rows = await tx
    .select({ customerId: leads.customerId, count: sql<number>`count(*)::int` })
    .from(leads)
    .where(inArray(leads.customerId, customerIds))
    .groupBy(leads.customerId);
  for (const row of rows) map.set(row.customerId, row.count);
  return map;
}

/** The lead board (C-12). */
export async function listBoard(tenantId: string): Promise<LeadCard[]> {
  return withTenant(tenantId, async (tx) => {
    const cutoff = new Date(Date.now() - CLOSED_VISIBLE_DAYS * 86_400_000);
    const rows = await tx
      .select({ lead: leads, customer: customers })
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .where(or(inArray(leads.stage, ["new", "contacted", "quoted", "scheduled"]), gte(leads.stageChangedAt, cutoff)))
      .orderBy(asc(leads.position), desc(leads.createdAt));

    const photos = await photoStats(tx, rows.map((r) => r.lead.id));
    const counts = await leadCountsByCustomer(tx, [...new Set(rows.map((r) => r.customer.id))]);
    return rows.map(({ lead, customer }) =>
      toCard(lead, customer, photos.get(lead.id) ?? { count: 0, coverId: null }, (counts.get(customer.id) ?? 0) > 1),
    );
  });
}

/** Lead detail with the full timeline and the customer's history (C-34). */
export async function getLeadDetail(tenantId: string, leadId: string): Promise<LeadDetail> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ lead: leads, customer: customers })
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .where(eq(leads.id, leadId));
    if (!row) throw notFound("Lead");

    const [events, callRows, messageRows, mediaRows, otherRows] = await Promise.all([
      // Events saved together share a timestamp; their time-ordered ids keep them in the order they happened.
      tx.select().from(leadEvents).where(eq(leadEvents.leadId, leadId)).orderBy(desc(leadEvents.createdAt), desc(leadEvents.id)),
      tx.select().from(calls).where(eq(calls.leadId, leadId)).orderBy(desc(calls.startedAt)),
      tx.select().from(messages).where(eq(messages.leadId, leadId)).orderBy(desc(messages.createdAt)),
      tx.select().from(mediaAssets).where(eq(mediaAssets.leadId, leadId)).orderBy(asc(mediaAssets.createdAt)),
      tx
        .select({ id: leads.id, title: leads.title, stage: leads.stage, createdAt: leads.createdAt, valueCents: leads.valueCents })
        .from(leads)
        .where(and(eq(leads.customerId, row.customer.id), ne(leads.id, leadId)))
        .orderBy(desc(leads.createdAt))
        .limit(20),
    ]);

    const photos = mediaRows.filter((m) => m.kind === "photo");
    const card = toCard(row.lead, row.customer, { count: photos.length, coverId: photos[0]?.id ?? null }, otherRows.length > 0);

    return {
      ...card,
      lostReason: row.lead.lostReason,
      events: events.map((e) => ({ id: e.id, type: e.type, actor: e.actor, data: e.data, createdAt: e.createdAt.toISOString() })),
      calls: callRows.map((c) => toCallItem(c, null)),
      messages: messageRows.map(toMessageItem),
      media: mediaRows.map(toMediaItem),
      otherLeads: otherRows.map((o) => ({ ...o, createdAt: o.createdAt.toISOString() })),
      intakeUrl: null,
    };
  });
}

export async function updateLead(tenantId: string, userId: string, leadId: string, input: LeadUpdateInput) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).for("update");
    if (!lead) throw notFound("Lead");
    const actor = `user:${userId}`;
    const patch: Partial<LeadRow> = {};

    if (input.stage && input.stage !== lead.stage) {
      patch.stage = input.stage;
      patch.stageChangedAt = new Date();
      patch.wonAt = input.stage === "won" ? new Date() : null;
      patch.needsCallback = input.stage === "new" ? lead.needsCallback : false;
      patch.position = input.position ?? (await topPosition(tx, tenantId, input.stage));
      await addLeadEvent(tx, { tenantId, leadId, type: "stage.changed", actor, data: { from: lead.stage, to: input.stage } });
    } else if (input.position !== undefined) {
      patch.position = input.position;
    }
    if (input.title !== undefined && input.title !== lead.title) {
      patch.title = input.title;
      patch.titleLocked = true;
    }
    if (input.valueDollars !== undefined) {
      const valueCents = input.valueDollars === null ? null : Math.round(input.valueDollars * 100);
      if (valueCents !== lead.valueCents) {
        patch.valueCents = valueCents;
        await addLeadEvent(tx, { tenantId, leadId, type: "value.set", actor, data: { valueCents } });
      }
    }
    if (input.scheduledFor !== undefined) {
      const scheduledFor = input.scheduledFor === null ? null : new Date(input.scheduledFor);
      if (scheduledFor?.getTime() !== lead.scheduledFor?.getTime()) {
        patch.scheduledFor = scheduledFor;
        await addLeadEvent(tx, {
          tenantId,
          leadId,
          type: scheduledFor ? "visit.booked" : "visit.cleared",
          actor,
          data: scheduledFor ? { at: scheduledFor.toISOString() } : {},
        });
      }
    }
    if (input.lostReason !== undefined) patch.lostReason = input.lostReason;
    if (input.customerName !== undefined) {
      await tx.update(customers).set({ name: input.customerName || null }).where(eq(customers.id, lead.customerId));
    }

    if (Object.keys(patch).length > 0) await tx.update(leads).set(patch).where(eq(leads.id, leadId));

    // A new visit or price moves the card along by itself, unless the owner picked a stage in this same change.
    if (input.stage === undefined) {
      const reason = patch.scheduledFor ? "visit_booked" : patch.valueCents != null ? "price_set" : null;
      if (reason) await advanceLead(tx, fx, { tenantId, leadId, reason });
    }
    fx.publish({ type: "lead.updated", leadId });
  });
  return getLeadDetail(tenantId, leadId);
}

/** The owner tapped Call or Text: log the attempt and treat the customer as contacted. */
export async function recordContact(tenantId: string, userId: string, leadId: string, channel: ContactChannel): Promise<LeadContactResult> {
  return tenantWork(tenantId, async (tx, fx) => {
    const [lead] = await tx.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId));
    if (!lead) throw notFound("Lead");

    const [last] = await tx
      .select({ data: leadEvents.data, createdAt: leadEvents.createdAt })
      .from(leadEvents)
      .where(and(eq(leadEvents.leadId, leadId), eq(leadEvents.type, "contact.started")))
      .orderBy(desc(leadEvents.createdAt))
      .limit(1);
    const repeatTap = last && last.data.channel === channel && Date.now() - last.createdAt.getTime() < REPEAT_TAP_MS;
    if (!repeatTap) await addLeadEvent(tx, { tenantId, leadId, type: "contact.started", actor: `user:${userId}`, data: { channel } });

    const moved = await advanceLead(tx, fx, { tenantId, leadId, reason: channel === "call" ? "owner_called" : "owner_texted" });
    fx.publish({ type: "lead.updated", leadId });
    return { moved };
  });
}

export async function addNote(tenantId: string, userId: string, leadId: string, text: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [lead] = await tx.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId));
    if (!lead) throw notFound("Lead");
    await addLeadEvent(tx, { tenantId, leadId, type: "note.added", actor: `user:${userId}`, data: { text } });
    fx.publish({ type: "lead.updated", leadId });
  });
}

/**
 * Owner asks for details: creates a fresh request link and tries to text it through the governed path.
 * The profile link (C-41) is added by default when this is the first text the lead gets.
 */
export async function requestDetails(tenantId: string, userId: string, leadId: string, options: { includeProfile?: boolean } = {}) {
  return tenantWork(tenantId, async (tx, fx) => {
    const [row] = await tx
      .select({ lead: leads, customer: customers, tenant: tenants })
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .innerJoin(tenants, eq(tenants.id, leads.tenantId))
      .where(eq(leads.id, leadId));
    if (!row) throw notFound("Lead");

    const url = await createIntakeLink(tx, { tenantId, leadId, customerId: row.customer.id });
    await addLeadEvent(tx, { tenantId, leadId, type: "intake.link_created", actor: `user:${userId}` });

    let message: MessageItem | null = null;
    if (row.customer.phoneE164) {
      const [earlier] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.leadId, leadId), eq(messages.direction, "outbound"), ne(messages.channel, "email")))
        .limit(1);
      const withProfile = options.includeProfile ?? (row.tenant.profileLinkInTexts && !earlier);
      const greeting = row.customer.name ? `Hi ${row.customer.name.split(" ")[0]}` : "Hi";
      const created = await requestMessage(tx, fx, {
        tenant: row.tenant,
        customerId: row.customer.id,
        leadId,
        to: row.customer.phoneE164,
        purpose: "transactional",
        body: `${greeting}, it's ${row.tenant.name}. Share the details of your job (photos help): ${url}\n${withProfile ? `${profileLine(row.tenant)}\n` : ""}Reply STOP to opt out.`,
      });
      message = toMessageItem(created);
      // The owner reached out — but only if the text was allowed to go.
      if (created.status !== "blocked") await advanceLead(tx, fx, { tenantId, leadId, reason: "form_sent" });
    }
    fx.publish({ type: "lead.updated", leadId });
    return { url, message };
  });
}

export function toCallItem(c: typeof calls.$inferSelect, customer: CustomerRow | null): CallItem {
  return {
    id: c.id,
    from: c.fromE164,
    to: c.toE164,
    callerType: c.callerType,
    outcome: c.outcome,
    customer: customer ? { id: customer.id, name: customer.name, phone: customer.phoneE164, isReturning: c.callerType === "known" } : null,
    leadId: c.leadId,
    durationSecs: c.durationSecs,
    transcript: c.transcript,
    consentCapturedAt: iso(c.consentCapturedAt),
    startedAt: c.startedAt.toISOString(),
    endedAt: iso(c.endedAt),
  };
}

export function toMessageItem(m: typeof messages.$inferSelect): MessageItem {
  return {
    id: m.id,
    direction: m.direction,
    channel: m.channel,
    purpose: m.purpose,
    status: m.status,
    body: m.body,
    blockedReason: m.blockedReason,
    provider: m.provider,
    createdAt: isoOrNow(m.createdAt),
  };
}

function toMediaItem(m: typeof mediaAssets.$inferSelect): MediaItem {
  return {
    id: m.id,
    kind: m.kind,
    mimeType: m.mimeType,
    width: m.width,
    height: m.height,
    aiStatus: m.aiStatus,
    showcase: m.showcase,
    aiTags: (m.aiTags as MediaItem["aiTags"]) ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}
