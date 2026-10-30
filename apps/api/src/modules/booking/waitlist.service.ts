import {
  type PublicOffer,
  WAITLIST_CONSENT_VERSION,
  type WaitlistItem,
  type waitlistJoinInput,
  waitlistConsentText,
} from "@leadanchor/contracts";
import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import type { z } from "zod";
import { linkBaseUrl } from "../../config/env";
import { consentLedger } from "../../container";
import { type Tx, systemDb, withTenant } from "../../db/client";
import {
  bookings,
  customers,
  services,
  tenants,
  waitlistEntries,
  waitlistOfferRecipients,
  waitlistOffers,
} from "../../db/schema";
import { type Effects, tenantWork } from "../../db/unit-of-work";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../../lib/crypto";
import { HttpError, notFound } from "../../lib/errors";
import { iso } from "../../lib/time";
import { friendlyTime, shiftDate, zonedTime } from "../../lib/zoned";
import { addLeadEvent } from "../leads/lead-capture";
import { requestEmail, requestMessage } from "../messaging/send-path";
import { notifyOwner } from "../notifications/notify";
import { publicBusinessOf } from "../payments/payment.service";
import {
  type FreedSlot,
  type Tenant,
  assertFree,
  customerOf,
  durationOf,
  insertBooking,
  leadForBooking,
  linkOf,
  lockBookings,
  moveBooking,
  sendBookingMessage,
  settingsOf,
} from "./core";

/** A waitlist offer's own page: take the freed slot with one tap (C-22). */
export const offerUrl = (token: string) => `${linkBaseUrl}/w/${token}`;

/** How many people one freed slot goes to: first come, first offered. */
const OFFER_FANOUT = 5;

/** C-22: join the waitlist from the booking page when no time suits. */
export async function joinWaitlist(
  slug: string,
  input: z.output<typeof waitlistJoinInput>,
  meta: { ipAddress: string | null },
) {
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!tenant || tenant.status === "cancelled" || tenant.status === "suspended")
    throw notFound("Business");
  if (input.company) return { ok: true as const };
  if (input.to < input.from)
    throw new HttpError(422, "validation_failed", "The last day must be after the first.", {
      to: ["Pick a later day"],
    });
  // An opening is offered by email or text; with neither, nobody could tell them.
  if (!input.email && !input.smsConsent) {
    throw new HttpError(
      422,
      "validation_failed",
      "Add your email or tick the box, so you hear when a time opens up.",
      { email: ["Add your email, or tick the box below"] },
    );
  }

  await tenantWork(tenant.id, async (tx, fx) => {
    const [service] = await tx
      .select()
      .from(services)
      .where(and(eq(services.id, input.serviceId), eq(services.active, true)));
    if (!service) throw notFound("Service");
    const { customer, lead } = await leadForBooking(tx, fx, {
      tenant,
      phone: input.phone,
      name: input.name,
      email: input.email || null,
      title: `Waitlist: ${service.name}`,
      estimateCents: service.priceCents,
      channel: input.source,
    });
    const now = new Date();
    const [entry] = await tx
      .insert(waitlistEntries)
      .values({
        tenantId: tenant.id,
        customerId: customer.id,
        leadId: lead.id,
        serviceId: service.id,
        windowStart: zonedTime(input.from, "00:00", tenant.timezone),
        windowEnd: zonedTime(shiftDate(input.to, 1), "00:00", tenant.timezone),
        ...(input.smsConsent && {
          smsConsentAt: now,
          consentVersion: WAITLIST_CONSENT_VERSION,
          consentIp: meta.ipAddress,
        }),
      })
      .returning();
    if (input.smsConsent)
      await recordWaitlistConsent(tx, tenant, input.phone, meta.ipAddress, lead.id);
    await addLeadEvent(tx, {
      tenantId: tenant.id,
      leadId: lead.id,
      type: "waitlist.joined",
      actor: "customer",
      data: {
        entryId: entry!.id,
        service: service.name,
        from: input.from,
        to: input.to,
        texts: input.smsConsent,
      },
    });
    await notifyOwner(tx, fx, {
      tenantId: tenant.id,
      kind: "booking",
      title: `${input.name} joined your waitlist`,
      body: `${service.name}, any time ${input.from === input.to ? `on ${input.from}` : `from ${input.from} to ${input.to}`}. You'll both hear if a time opens up.`,
      leadId: lead.id,
      callbackPhone: input.phone,
    });
    fx.publish({ type: "waitlist.updated" });
    fx.publish({ type: "lead.updated", leadId: lead.id });
  });
  return { ok: true as const };
}

/** C-22: the waitlist opt-in is its own box, written to the ledger with its own wording. */
export async function recordWaitlistConsent(
  tx: Tx,
  tenant: Tenant,
  phone: string,
  ipAddress: string | null,
  leadId: string,
) {
  await consentLedger.record(
    {
      tenantId: tenant.id,
      phoneE164: phone,
      type: "sms_transactional",
      action: "GRANTED",
      source: "web_form",
      textVersion: WAITLIST_CONSENT_VERSION,
      evidence: `Ticked: "${waitlistConsentText(tenant.name)}"`,
      ipAddress,
      grantedTo: `${tenant.name} (${tenant.id})`,
    },
    tx,
  );
  await addLeadEvent(tx, {
    tenantId: tenant.id,
    leadId,
    type: "consent.granted",
    actor: "customer",
    data: {
      channel: "sms",
      type: "sms_transactional",
      source: "web_form",
      textVersion: WAITLIST_CONSENT_VERSION,
      answer: "Ticked the waitlist box",
    },
  });
}

/**
 * C-22: a slot just opened. Offer it to the people waiting whose service fits it and whose dates
 * cover it, oldest first. Each gets their own link by email (and by text once waitlist texts
 * are cleared); the first to take it gets it. The owner sees who was offered it either way.
 */
export async function offerFreedSlot(tx: Tx, fx: Effects, tenant: Tenant, slot: FreedSlot) {
  const settings = settingsOf(tenant);
  if (slot.start.getTime() < Date.now() + settings.noticeHours * 3_600_000) return 0;

  const candidates = await tx
    .select({ entry: waitlistEntries, customer: customers, durationMins: services.durationMins })
    .from(waitlistEntries)
    .innerJoin(customers, eq(customers.id, waitlistEntries.customerId))
    .leftJoin(services, eq(services.id, waitlistEntries.serviceId))
    .where(
      and(
        eq(waitlistEntries.status, "waiting"),
        lte(waitlistEntries.windowStart, slot.start),
        gt(waitlistEntries.windowEnd, slot.start),
      ),
    )
    .orderBy(asc(waitlistEntries.createdAt));
  const fits = candidates
    .filter(({ entry, customer, durationMins }) => {
      const end = slot.start.getTime() + durationOf({ durationMins }) * 60_000;
      return (
        customer.id !== slot.customerId &&
        end <= slot.end.getTime() &&
        end <= entry.windowEnd.getTime()
      );
    })
    .slice(0, OFFER_FANOUT);
  if (fits.length === 0) return 0;

  const [offer] = await tx
    .insert(waitlistOffers)
    .values({
      tenantId: tenant.id,
      serviceId: slot.serviceId,
      serviceName: slot.serviceName,
      startsAt: slot.start,
      endsAt: slot.end,
      expiresAt: new Date(slot.start.getTime() - settings.noticeHours * 3_600_000),
    })
    .returning();
  const when = friendlyTime(slot.start, tenant.timezone);
  let reached = 0;

  for (const { entry, customer } of fits) {
    const token = randomToken();
    const link = offerUrl(token);
    const [recipient] = await tx
      .insert(waitlistOfferRecipients)
      .values({
        tenantId: tenant.id,
        offerId: offer!.id,
        entryId: entry.id,
        tokenHash: sha256(token),
        tokenSealed: encryptSecret(token),
      })
      .returning();
    const hi = customer.name ? `Hi ${customer.name.trim().split(/\s+/)[0]}` : "Hi";
    const earlier = entry.bookingId ? " That's earlier than your booking." : "";
    let texted = false;
    let emailed = false;
    if (entry.smsConsentAt && customer.phoneE164) {
      const message = await requestMessage(tx, fx, {
        tenant,
        customerId: customer.id,
        leadId: entry.leadId,
        to: customer.phoneE164,
        purpose: "waitlist_offer",
        body: `${hi}, a time just opened up with ${tenant.name}: ${when}.${earlier} Reply YES to take it, or tap: ${link}`,
      });
      texted = message.status !== "blocked";
    }
    if (customer.email) {
      await requestEmail(tx, fx, {
        tenant,
        customerId: customer.id,
        leadId: entry.leadId,
        to: customer.email,
        purpose: "waitlist_offer",
        subject: `A time opened up with ${tenant.name}: ${when}`,
        body: `${hi},\n\nA time just opened up with ${tenant.name}: ${when}.${earlier}\n\nIt goes to whoever takes it first. Take it here:\n${link}\n\n${tenant.name}`,
      });
      emailed = true;
    }
    if (texted || emailed) reached += 1;
    await tx
      .update(waitlistOfferRecipients)
      .set({ ...(texted && { textedAt: new Date() }), ...(emailed && { emailedAt: new Date() }) })
      .where(eq(waitlistOfferRecipients.id, recipient!.id));
    await tx
      .update(waitlistEntries)
      .set({ lastOfferedAt: new Date() })
      .where(eq(waitlistEntries.id, entry.id));
    if (entry.leadId) {
      await addLeadEvent(tx, {
        tenantId: tenant.id,
        leadId: entry.leadId,
        type: "waitlist.offered",
        actor: "system",
        data: { offerId: offer!.id, startsAt: slot.start.toISOString(), texted, emailed },
      });
    }
  }

  await notifyOwner(tx, fx, {
    tenantId: tenant.id,
    kind: "booking",
    title: `${when} opened up`,
    body:
      reached > 0
        ? `Offered to ${reached} ${reached === 1 ? "person" : "people"} on your waitlist. The first to say yes gets it.`
        : `${fits.length} on your waitlist could take it, but can't be reached by email or text yet. Call them from the waitlist.`,
  });
  fx.publish({ type: "waitlist.updated" });
  return reached;
}

async function resolveRecipient(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound("Offer");
  const [row] = await systemDb
    .select({ recipient: waitlistOfferRecipients, offer: waitlistOffers, entry: waitlistEntries })
    .from(waitlistOfferRecipients)
    .innerJoin(waitlistOffers, eq(waitlistOffers.id, waitlistOfferRecipients.offerId))
    .innerJoin(waitlistEntries, eq(waitlistEntries.id, waitlistOfferRecipients.entryId))
    .where(eq(waitlistOfferRecipients.tokenHash, sha256(token)))
    .limit(1);
  if (!row) throw notFound("Offer");
  return row;
}

async function offerView(row: Awaited<ReturnType<typeof resolveRecipient>>): Promise<PublicOffer> {
  const [[tenant], [customer], [service]] = await Promise.all([
    systemDb.select().from(tenants).where(eq(tenants.id, row.offer.tenantId)),
    systemDb
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, row.entry.customerId)),
    row.entry.serviceId
      ? systemDb.select().from(services).where(eq(services.id, row.entry.serviceId))
      : Promise.resolve([]),
  ]);
  const mine = row.offer.status === "taken" && row.offer.takenByEntryId === row.entry.id;
  const [booking] = mine
    ? await systemDb
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.customerId, row.entry.customerId),
            eq(bookings.startsAt, row.offer.startsAt),
            eq(bookings.status, "booked"),
          ),
        )
        .limit(1)
    : [];
  const [current] =
    !mine && row.entry.bookingId
      ? await systemDb
          .select({ startsAt: bookings.startsAt })
          .from(bookings)
          .where(and(eq(bookings.id, row.entry.bookingId), eq(bookings.status, "booked")))
          .limit(1)
      : [];
  const expired =
    row.offer.status === "expired" ||
    (row.offer.status === "open" && row.offer.expiresAt.getTime() < Date.now());
  const durationMins = durationOf(service ?? null);
  return {
    business: await publicBusinessOf(tenant!),
    state: mine ? "yours" : row.offer.status === "taken" ? "taken" : expired ? "expired" : "open",
    service: { name: service?.name ?? row.offer.serviceName ?? "Visit", durationMins },
    startsAt: row.offer.startsAt.toISOString(),
    endsAt: new Date(row.offer.startsAt.getTime() + durationMins * 60_000).toISOString(),
    timezone: tenant!.timezone,
    customerName: customer?.name ?? null,
    manageUrl: booking ? linkOf(booking) : null,
    replaces: current ? current.startsAt.toISOString() : null,
  };
}

export async function getPublicOffer(token: string) {
  return offerView(await resolveRecipient(token));
}

/** "Yes, I'll take it": the first yes books the slot (or moves their booking to it). */
export async function takeOffer(token: string): Promise<PublicOffer> {
  const row = await resolveRecipient(token);
  await claimOffer(row.offer.tenantId, row.recipient.id);
  return offerView(await resolveRecipient(token));
}

/** Takes an offer for one recipient: by link or by a YES reply. Returns false when it's gone. */
export async function claimOffer(
  tenantId: string,
  recipientId: string,
  existing?: { tx: Tx; fx: Effects },
): Promise<boolean> {
  const run = async (tx: Tx, fx: Effects) => {
    await lockBookings(tx, tenantId);
    const [row] = await tx
      .select({ recipient: waitlistOfferRecipients, offer: waitlistOffers, entry: waitlistEntries })
      .from(waitlistOfferRecipients)
      .innerJoin(waitlistOffers, eq(waitlistOffers.id, waitlistOfferRecipients.offerId))
      .innerJoin(waitlistEntries, eq(waitlistEntries.id, waitlistOfferRecipients.entryId))
      .where(eq(waitlistOfferRecipients.id, recipientId));
    if (!row) throw notFound("Offer");
    const { offer, entry } = row;
    if (offer.status === "taken" && offer.takenByEntryId === entry.id) return true;
    if (
      offer.status !== "open" ||
      offer.expiresAt.getTime() < Date.now() ||
      entry.status !== "waiting"
    )
      return false;

    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const settings = settingsOf(tenant!);
    const [service] = entry.serviceId
      ? await tx.select().from(services).where(eq(services.id, entry.serviceId))
      : [];
    const start = offer.startsAt;
    const end = new Date(start.getTime() + durationOf(service ?? null) * 60_000);
    const [current] = entry.bookingId
      ? await tx
          .select()
          .from(bookings)
          .where(and(eq(bookings.id, entry.bookingId), eq(bookings.status, "booked")))
      : [];
    try {
      await assertFree(tx, {
        start,
        end,
        bufferMins: settings.bufferMins,
        exceptBookingId: current?.id,
      });
    } catch {
      // Someone (or the owner) got there first.
      await tx
        .update(waitlistOffers)
        .set({ status: "taken" })
        .where(eq(waitlistOffers.id, offer.id));
      return false;
    }

    const customer = await customerOf(tx, entry.customerId);
    let booking;
    if (current) {
      // Already booked for later: move their booking up, and offer the later slot onwards.
      const moved = await moveBooking(tx, fx, {
        tenant: tenant!,
        booking: current,
        startsAt: start,
        endsAt: end,
        actor: "customer",
      });
      booking = moved.row;
      await sendBookingMessage(tx, fx, { tenant: tenant!, customer, booking, kind: "moved" });
      await offerFreedSlot(tx, fx, tenant!, moved.freed);
    } else {
      const leadId =
        entry.leadId ??
        (
          await leadForBooking(tx, fx, {
            tenant: tenant!,
            phone: customer.phoneE164!,
            name: customer.name ?? "Customer",
            email: customer.email,
            title: service?.name ?? "Visit",
            estimateCents: service?.priceCents ?? null,
            channel: "link",
          })
        ).lead.id;
      booking = (
        await insertBooking(tx, fx, {
          tenant: tenant!,
          leadId,
          customerId: customer.id,
          service: service ? { id: service.id, name: service.name } : null,
          startsAt: start,
          endsAt: end,
          source: "waitlist",
          actor: "customer",
        })
      ).row;
      await sendBookingMessage(tx, fx, { tenant: tenant!, customer, booking, kind: "booked" });
    }
    await tx
      .update(waitlistOffers)
      .set({ status: "taken", takenByEntryId: entry.id, takenAt: new Date() })
      .where(eq(waitlistOffers.id, offer.id));
    await tx
      .update(waitlistEntries)
      .set({ status: "booked" })
      .where(eq(waitlistEntries.id, entry.id));
    await addLeadEvent(tx, {
      tenantId,
      leadId: booking.leadId,
      type: "waitlist.took",
      actor: "customer",
      data: { offerId: offer.id, startsAt: start.toISOString(), moved: Boolean(current) },
    });
    await notifyOwner(tx, fx, {
      tenantId,
      kind: "booking",
      title: `${customer.name ?? "A customer"} took ${friendlyTime(start, tenant!.timezone)}`,
      body: `From your waitlist${current ? ", moved up from their later booking" : ""}. ${booking.serviceName ?? ""}`.trim(),
      leadId: booking.leadId,
    });
    fx.publish({ type: "waitlist.updated" });
    return true;
  };
  return existing ? run(existing.tx, existing.fx) : tenantWork(tenantId, run);
}

/* ── The owner's waitlist ────────────────────────────────────────────────── */

export async function listWaitlist(tenantId: string): Promise<WaitlistItem[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ entry: waitlistEntries, customer: customers, service: services, booking: bookings })
      .from(waitlistEntries)
      .innerJoin(customers, eq(customers.id, waitlistEntries.customerId))
      .leftJoin(services, eq(services.id, waitlistEntries.serviceId))
      .leftJoin(bookings, eq(bookings.id, waitlistEntries.bookingId))
      .where(and(eq(waitlistEntries.status, "waiting"), gt(waitlistEntries.windowEnd, new Date())))
      .orderBy(asc(waitlistEntries.createdAt));
    return rows.map(({ entry, customer, service, booking }) => ({
      id: entry.id,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phoneE164,
        email: customer.email,
      },
      service: service ? { id: service.id, name: service.name } : null,
      from: entry.windowStart.toISOString(),
      to: entry.windowEnd.toISOString(),
      bookedFor: booking?.status === "booked" ? booking.startsAt.toISOString() : null,
      textsAllowed: Boolean(entry.smsConsentAt),
      status: entry.status,
      lastOfferedAt: iso(entry.lastOfferedAt),
      leadId: entry.leadId,
      createdAt: entry.createdAt.toISOString(),
    }));
  });
}

export async function removeFromWaitlist(tenantId: string, userId: string, entryId: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [entry] = await tx
      .update(waitlistEntries)
      .set({ status: "removed" })
      .where(eq(waitlistEntries.id, entryId))
      .returning();
    if (!entry) throw notFound("Waitlist entry");
    if (entry.leadId)
      await addLeadEvent(tx, {
        tenantId,
        leadId: entry.leadId,
        type: "waitlist.removed",
        actor: `user:${userId}`,
        data: { entryId },
      });
    fx.publish({ type: "waitlist.updated" });
  });
}

/** Offers still open to this phone (for a YES reply), newest first. */
export async function openOffersFor(tx: Tx, customerId: string) {
  return tx
    .select({ recipient: waitlistOfferRecipients, offer: waitlistOffers })
    .from(waitlistOfferRecipients)
    .innerJoin(waitlistOffers, eq(waitlistOffers.id, waitlistOfferRecipients.offerId))
    .innerJoin(waitlistEntries, eq(waitlistEntries.id, waitlistOfferRecipients.entryId))
    .where(
      and(
        eq(waitlistEntries.customerId, customerId),
        inArray(waitlistOffers.status, ["open"]),
        gt(waitlistOffers.expiresAt, new Date()),
      ),
    );
}

export const offerLinkOf = (row: { tokenSealed: string }) =>
  offerUrl(decryptSecret(row.tokenSealed));
