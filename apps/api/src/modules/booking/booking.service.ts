import {
  BOOKING_CONSENT_TEXT,
  BOOKING_CONSENT_VERSION,
  type BookingCreated,
  type BookingItem,
  type BookingSettings,
  type BookingSettingsResponse,
  type MessageItem,
  type PublicBooking,
  type PublicBookingContext,
  type SlotsResponse,
  WAITLIST_CONSENT_VERSION,
  type bookingInput,
  type noShowInput,
  type ownerBookingInput,
} from "@leadanchor/contracts";
import { and, asc, desc, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import { consentLedger } from "../../container";
import { type Tx, systemDb, withTenant } from "../../db/client";
import {
  bookings,
  customers,
  leads,
  paymentRequests,
  services,
  tenants,
  waitlistEntries,
  waitlistOffers,
} from "../../db/schema";
import { type Effects, tenantWork } from "../../db/unit-of-work";
import { QUEUES } from "../../jobs/queue";
import { sha256 } from "../../lib/crypto";
import { HttpError, notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { friendlyTime } from "../../lib/zoned";
import { audit } from "../compliance/audit";
import { requestUrl } from "../intake/intake.service";
import { addLeadEvent } from "../leads/lead-capture";
import { toMessageItem } from "../messaging/message-item";
import { creditCampaign } from "../campaigns/links";
import { notifyOwner } from "../notifications/notify";
import { capturePayment, publicBusinessOf } from "../payments/payment.service";
import { availableSlots, isBookable } from "./availability";
import { calendarStatusOf } from "./calendar-sync";
import {
  type BookingRow,
  type Tenant,
  assertFree,
  bookingUrl,
  busyBetween,
  cancelBooking,
  customerOf,
  durationOf,
  insertBooking,
  leadForBooking,
  lockBookings,
  manageUrl,
  moveBooking,
  sendBookingMessage,
  serviceOf,
  settingsOf,
  toBookingItem,
  wantsEarlier,
} from "./core";
import { offerFreedSlot, recordWaitlistConsent } from "./waitlist.service";

const DAY_MS = 86_400_000;

/* ── Settings (C-17: hours, step, notice, window, buffer) ────────────────── */

export async function getBookingSettings(tenantId: string): Promise<BookingSettingsResponse> {
  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [missing] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(services)
      .where(and(eq(services.active, true), isNull(services.durationMins)));
    return {
      settings: settingsOf(tenant!),
      timezone: tenant!.timezone,
      bookingUrl: bookingUrl(tenant!.slug),
      calendar: await calendarStatusOf(tx),
      servicesWithoutTime: missing?.n ?? 0,
    };
  });
}

export async function updateBookingSettings(
  tenantId: string,
  userId: string,
  settings: BookingSettings,
): Promise<BookingSettingsResponse> {
  await tenantWork(tenantId, async (tx, fx) => {
    await tx.update(tenants).set({ booking: settings }).where(eq(tenants.id, tenantId));
    // Hours and the booking link are kept on the Google listing too (C-21).
    fx.enqueue(QUEUES.listingPush, { tenantId });
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "booking.settings_updated",
      entityType: "tenant",
      entityId: tenantId,
      data: { enabled: settings.enabled },
    });
    fx.publish({ type: "settings.updated" });
  });
  return getBookingSettings(tenantId);
}

/* ── The public booking page (C-18) ──────────────────────────────────────── */

async function tenantBySlug(slug: string) {
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!tenant || tenant.status === "cancelled" || tenant.status === "suspended")
    throw notFound("Business");
  return tenant;
}

export async function getPublicBookingContext(slug: string): Promise<PublicBookingContext> {
  const tenant = await tenantBySlug(slug);
  const rows = await systemDb
    .select()
    .from(services)
    .where(and(eq(services.tenantId, tenant.id), eq(services.active, true)))
    .orderBy(asc(services.sortOrder));
  return {
    business: await publicBusinessOf(tenant),
    enabled: settingsOf(tenant).enabled,
    timezone: tenant.timezone,
    services: rows.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      durationMins: durationOf(service),
      priceCents: service.priceCents,
    })),
    requestUrl: requestUrl(tenant.slug),
  };
}

async function slotsFor(
  tx: Tx,
  input: {
    tenant: Tenant;
    settings: BookingSettings;
    durationMins: number;
    exceptBookingId?: string;
  },
) {
  const now = new Date();
  const busy = await busyBetween(
    tx,
    new Date(now.getTime() - DAY_MS),
    new Date(now.getTime() + (input.settings.windowDays + 2) * DAY_MS),
    input.exceptBookingId,
  );
  return availableSlots({
    settings: input.settings,
    timezone: input.tenant.timezone,
    durationMins: input.durationMins,
    busy,
    now,
  }).map((day) => ({
    date: day.date,
    slots: day.slots.map((slot) => slot.toISOString()),
  }));
}

export async function publicSlots(slug: string, serviceId: string): Promise<SlotsResponse> {
  const tenant = await tenantBySlug(slug);
  const settings = settingsOf(tenant);
  if (!settings.enabled)
    throw new HttpError(
      409,
      "booking_off",
      `${tenant.name} isn't taking online bookings right now.`,
    );
  return withTenant(tenant.id, async (tx) => {
    const [service] = await tx
      .select()
      .from(services)
      .where(and(eq(services.id, serviceId), eq(services.active, true)));
    if (!service) throw notFound("Service");
    const durationMins = durationOf(service);
    return {
      serviceId,
      durationMins,
      timezone: tenant.timezone,
      days: await slotsFor(tx, { tenant, settings, durationMins }),
    };
  });
}

const BOOKINGS_PER_HOUR = 5;
const recentBookings = new Map<string, number[]>();

/** C-18 / C-19: the customer books a slot; it's locked, confirmed by text and on the owner's board at once. */
export async function bookOnline(
  slug: string,
  input: z.output<typeof bookingInput>,
  meta: { ipAddress: string | null },
): Promise<BookingCreated> {
  const tenant = await tenantBySlug(slug);
  const settings = settingsOf(tenant);
  if (!settings.enabled)
    throw new HttpError(
      409,
      "booking_off",
      `${tenant.name} isn't taking online bookings right now.`,
    );
  // Only bots fill in the hidden field.
  if (input.company)
    throw new HttpError(
      400,
      "bad_request",
      "Something went wrong. Please call the business instead.",
    );

  const key = `${tenant.id}:${meta.ipAddress ?? "unknown"}`;
  const recent = (recentBookings.get(key) ?? []).filter((at) => Date.now() - at < 3_600_000);
  if (recent.length >= BOOKINGS_PER_HOUR)
    throw new HttpError(
      429,
      "too_many_requests",
      `You've booked several times already. Please call ${tenant.name} instead.`,
    );
  if (recentBookings.size > 10_000) recentBookings.clear();
  recentBookings.set(key, [...recent, Date.now()]);

  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime()))
    throw new HttpError(422, "validation_failed", "Pick a time.", { startsAt: ["Pick a time"] });

  const token = await tenantWork(tenant.id, async (tx, fx) => {
    const [service] = await tx
      .select()
      .from(services)
      .where(and(eq(services.id, input.serviceId), eq(services.active, true)));
    if (!service) throw notFound("Service");
    const durationMins = durationOf(service);
    const endsAt = new Date(startsAt.getTime() + durationMins * 60_000);

    // The lock makes the check and the booking one step: two people can't take the same time.
    await lockBookings(tx, tenant.id);
    const busy = await busyBetween(
      tx,
      new Date(startsAt.getTime() - DAY_MS),
      new Date(endsAt.getTime() + DAY_MS),
    );
    if (
      !isBookable(
        { settings, timezone: tenant.timezone, durationMins, busy, now: new Date() },
        startsAt,
      )
    ) {
      throw new HttpError(409, "slot_taken", "That time was just taken. Please pick another.");
    }

    const { customer, lead } = await leadForBooking(tx, fx, {
      tenant,
      phone: input.phone,
      name: input.name,
      email: input.email || null,
      title: service.name,
      estimateCents: service.priceCents,
      channel: input.source,
    });
    const created = await insertBooking(tx, fx, {
      tenant,
      leadId: lead.id,
      customerId: customer.id,
      service: { id: service.id, name: service.name },
      startsAt,
      endsAt,
      source: "customer",
      channel: input.source,
      notes: input.notes,
      actor: "customer",
    });
    if (input.notes)
      await addLeadEvent(tx, {
        tenantId: tenant.id,
        leadId: lead.id,
        type: "note.added",
        actor: "customer",
        data: { text: input.notes },
      });

    if (input.smsConsent) {
      await consentLedger.record(
        {
          tenantId: tenant.id,
          phoneE164: input.phone,
          type: "sms_transactional",
          action: "GRANTED",
          source: "web_form",
          textVersion: BOOKING_CONSENT_VERSION,
          evidence: `Ticked: "${BOOKING_CONSENT_TEXT}"`,
          ipAddress: meta.ipAddress,
          grantedTo: `${tenant.name} (${tenant.id})`,
        },
        tx,
      );
      await addLeadEvent(tx, {
        tenantId: tenant.id,
        leadId: lead.id,
        type: "consent.granted",
        actor: "customer",
        data: {
          channel: "sms",
          type: "sms_transactional",
          source: "web_form",
          textVersion: BOOKING_CONSENT_VERSION,
          answer: "Ticked the box",
        },
      });
    }
    // C-44: booked from a campaign email; the job shows which offer it came with.
    if (input.campaign) await creditCampaign(tx, { tenant, token: input.campaign, leadId: lead.id, via: "booking" });
    if (input.earlier) {
      // C-22: hoping for an earlier time; offers come by email, and by text with this separate opt-in.
      await tx.insert(waitlistEntries).values({
        tenantId: tenant.id,
        customerId: customer.id,
        leadId: lead.id,
        serviceId: service.id,
        bookingId: created.row.id,
        windowStart: new Date(),
        windowEnd: startsAt,
        smsConsentAt: new Date(),
        consentVersion: WAITLIST_CONSENT_VERSION,
        consentIp: meta.ipAddress,
      });
      await recordWaitlistConsent(tx, tenant, input.phone, meta.ipAddress, lead.id);
      fx.publish({ type: "waitlist.updated" });
    }

    const sent = await sendBookingMessage(tx, fx, {
      tenant,
      customer: await customerOf(tx, customer.id),
      booking: created.row,
      kind: "booked",
    });
    if (sent.some((message) => message.status !== "blocked")) {
      await tx
        .update(bookings)
        .set({ confirmationSentAt: new Date() })
        .where(eq(bookings.id, created.row.id));
    }
    await notifyOwner(tx, fx, {
      tenantId: tenant.id,
      kind: "booking",
      title: `New booking: ${input.name}`,
      body: `${service.name}, ${friendlyTime(startsAt, tenant.timezone)}. It's on your schedule.`,
      leadId: lead.id,
      callbackPhone: input.phone,
    });
    return created.token;
  });
  return { manageUrl: manageUrl(token), booking: await getPublicBooking(token) };
}

/* ── The customer's own booking page ─────────────────────────────────────── */

async function resolveBooking(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound("Booking");
  const [row] = await systemDb
    .select()
    .from(bookings)
    .where(eq(bookings.tokenHash, sha256(token)))
    .limit(1);
  if (!row) throw notFound("Booking");
  return row;
}

const changeable = (row: BookingRow, settings: BookingSettings) =>
  row.status === "booked" && row.startsAt.getTime() - settings.noticeHours * 3_600_000 > Date.now();

export async function getPublicBooking(token: string): Promise<PublicBooking> {
  const row = await resolveBooking(token);
  const [[tenant], [customer], [entry]] = await Promise.all([
    systemDb.select().from(tenants).where(eq(tenants.id, row.tenantId)),
    systemDb
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, row.customerId)),
    systemDb
      .select({ id: waitlistEntries.id })
      .from(waitlistEntries)
      .where(and(eq(waitlistEntries.bookingId, row.id), eq(waitlistEntries.status, "waiting")))
      .limit(1),
  ]);
  return {
    business: await publicBusinessOf(tenant!),
    status: row.status,
    service: {
      name: row.serviceName ?? "Visit",
      durationMins: Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000),
    },
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: tenant!.timezone,
    customerName: customer?.name ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    canChange: changeable(row, settingsOf(tenant!)),
    serviceId: row.serviceId,
    wantsEarlier: Boolean(entry),
    bookingUrl: bookingUrl(tenant!.slug),
  };
}

export async function publicRescheduleSlots(token: string): Promise<SlotsResponse> {
  const row = await resolveBooking(token);
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.id, row.tenantId));
  const settings = settingsOf(tenant!);
  const durationMins = Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000);
  return withTenant(row.tenantId, async (tx) => ({
    serviceId: row.serviceId ?? "",
    durationMins,
    timezone: tenant!.timezone,
    days: await slotsFor(tx, { tenant: tenant!, settings, durationMins, exceptBookingId: row.id }),
  }));
}

/** C-20: cancelling frees the slot at once, and the waitlist hears about it (C-22). */
export async function cancelByCustomer(token: string, reason: string): Promise<PublicBooking> {
  const row = await resolveBooking(token);
  if (row.status === "booked") {
    await tenantWork(row.tenantId, async (tx, fx) => {
      await lockBookings(tx, row.tenantId);
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, row.id));
      if (booking?.status !== "booked") return;
      await customerCancel(tx, fx, booking, reason);
    });
  }
  return getPublicBooking(token);
}

/** A customer's cancellation, by page or by reply: confirm it to them, tell the owner, offer the slot. */
export async function customerCancel(tx: Tx, fx: Effects, booking: BookingRow, reason: string) {
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, booking.tenantId));
  const customer = await customerOf(tx, booking.customerId);
  const { freed } = await cancelBooking(tx, fx, {
    tenant: tenant!,
    booking,
    by: "customer",
    reason,
    actor: "customer",
  });
  await sendBookingMessage(tx, fx, { tenant: tenant!, customer, booking, kind: "canceled" });
  const offered = freed ? await offerFreedSlot(tx, fx, tenant!, freed) : 0;
  await notifyOwner(tx, fx, {
    tenantId: tenant!.id,
    kind: "booking",
    title: `${customer.name ?? "A customer"} cancelled`,
    body: `${booking.serviceName ?? "Their visit"}, ${friendlyTime(booking.startsAt, tenant!.timezone)}.${reason ? ` “${reason}”` : ""}${offered > 0 ? ` Offered to ${offered} on your waitlist.` : " The slot is free again."}`,
    leadId: booking.leadId,
    callbackPhone: customer.phoneE164,
  });
}

export async function rescheduleByCustomer(
  token: string,
  startsAtText: string,
): Promise<PublicBooking> {
  const row = await resolveBooking(token);
  const startsAt = new Date(startsAtText);
  if (Number.isNaN(startsAt.getTime()))
    throw new HttpError(422, "validation_failed", "Pick a time.");
  await tenantWork(row.tenantId, async (tx, fx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, row.tenantId));
    const settings = settingsOf(tenant!);
    await lockBookings(tx, row.tenantId);
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, row.id));
    if (!booking || !changeable(booking, settings)) {
      throw new HttpError(
        409,
        "too_late",
        `This booking can't be changed online any more. Please call ${tenant!.name}.`,
      );
    }
    const durationMins = Math.round(
      (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000,
    );
    const busy = await busyBetween(
      tx,
      new Date(startsAt.getTime() - DAY_MS),
      new Date(startsAt.getTime() + DAY_MS),
      booking.id,
    );
    if (
      !isBookable(
        { settings, timezone: tenant!.timezone, durationMins, busy, now: new Date() },
        startsAt,
      )
    ) {
      throw new HttpError(409, "slot_taken", "That time was just taken. Please pick another.");
    }
    const moved = await moveBooking(tx, fx, {
      tenant: tenant!,
      booking,
      startsAt,
      endsAt: new Date(startsAt.getTime() + durationMins * 60_000),
      actor: "customer",
    });
    const customer = await customerOf(tx, booking.customerId);
    await sendBookingMessage(tx, fx, {
      tenant: tenant!,
      customer,
      booking: moved.row,
      kind: "moved",
    });
    await notifyOwner(tx, fx, {
      tenantId: tenant!.id,
      kind: "booking",
      title: `${customer.name ?? "A customer"} changed their booking`,
      body: `${booking.serviceName ?? "Visit"} moved from ${friendlyTime(booking.startsAt, tenant!.timezone)} to ${friendlyTime(startsAt, tenant!.timezone)}.`,
      leadId: booking.leadId,
    });
    await offerFreedSlot(tx, fx, tenant!, moved.freed);
  });
  return getPublicBooking(token);
}

/** "Add to my calendar": a standard .ics file. */
export async function bookingIcs(token: string) {
  const row = await resolveBooking(token);
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.id, row.tenantId));
  const stamp = (date: Date) =>
    date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const text = (value: string) =>
    value
      .replace(/\\/g, "\\\\")
      .replace(/[,;]/g, (char) => `\\${char}`)
      .replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LeadAnchor//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${row.id}@leadanchor`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(row.startsAt)}`,
    `DTEND:${stamp(row.endsAt)}`,
    `SUMMARY:${text(`${row.serviceName ?? "Visit"} with ${tenant!.name}`)}`,
    `STATUS:${row.status === "booked" ? "CONFIRMED" : "CANCELLED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return { filename: `${tenant!.slug}-booking.ics`, body: lines.join("\r\n") };
}

/* ── The owner's side ────────────────────────────────────────────────────── */

/** The visit shown on a lead: the upcoming booking, or the latest one. */
export async function bookingForLead(tx: Tx, leadId: string): Promise<BookingItem | null> {
  const [row] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.leadId, leadId))
    // The booked visit; otherwise whichever changed last (a no-show after a cancellation, say).
    .orderBy(
      sql`case when ${bookings.status} = 'booked' then 0 else 1 end`,
      desc(bookings.updatedAt),
    )
    .limit(1);
  return row ? toBookingItem(row, await wantsEarlier(tx, row.id)) : null;
}

/** Times the owner could book for this job: opening hours, no notice period, nothing double-booked. */
export async function ownerSlots(
  tenantId: string,
  leadId: string,
  input: { serviceId?: string; durationMins?: number },
): Promise<SlotsResponse> {
  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [current] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.leadId, leadId), eq(bookings.status, "booked")))
      .limit(1);
    const service = await serviceOf(tx, input.serviceId ?? current?.serviceId);
    const durationMins =
      input.durationMins ??
      (service
        ? durationOf(service)
        : current
          ? Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60_000)
          : durationOf(null));
    const settings = { ...settingsOf(tenant!), noticeHours: 0, windowDays: 30 };
    return {
      serviceId: service?.id ?? "",
      durationMins,
      timezone: tenant!.timezone,
      days: await slotsFor(tx, {
        tenant: tenant!,
        settings,
        durationMins,
        exceptBookingId: current?.id,
      }),
    };
  });
}

/**
 * The owner books (or moves) the visit for a job. A clash with another booking or the owner's
 * calendar is refused with what it clashes with, unless the owner says to book it anyway.
 */
export async function ownerBook(
  tenantId: string,
  userId: string,
  leadId: string,
  input: z.output<typeof ownerBookingInput>,
): Promise<{ booking: BookingItem; messages: MessageItem[] }> {
  return tenantWork(tenantId, async (tx, fx) => {
    const [row] = await tx
      .select({ lead: leads, tenant: tenants })
      .from(leads)
      .innerJoin(tenants, eq(tenants.id, leads.tenantId))
      .where(eq(leads.id, leadId));
    if (!row) throw notFound("Lead");
    const { lead, tenant } = row;
    const startsAt = new Date(input.startsAt);
    await lockBookings(tx, tenantId);
    const [current] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.leadId, leadId), eq(bookings.status, "booked")))
      .limit(1);
    const service = (await serviceOf(tx, input.serviceId ?? current?.serviceId)) ?? null;
    const durationMins =
      input.durationMins ??
      (service
        ? durationOf(service)
        : current
          ? Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60_000)
          : durationOf(null));
    const endsAt = new Date(startsAt.getTime() + durationMins * 60_000);
    if (!input.allowOverlap)
      await assertFree(tx, {
        start: startsAt,
        end: endsAt,
        bufferMins: 0,
        exceptBookingId: current?.id,
      });

    const customer = await customerOf(tx, lead.customerId);
    const actor = `user:${userId}`;
    let booking: BookingRow;
    if (current) {
      const moved = await moveBooking(tx, fx, {
        tenant,
        booking: current,
        startsAt,
        endsAt,
        actor,
      });
      booking = moved.row;
      if (service && service.id !== current.serviceId) {
        [booking] = (await tx
          .update(bookings)
          .set({ serviceId: service.id, serviceName: service.name })
          .where(eq(bookings.id, current.id))
          .returning()) as [BookingRow];
      }
      await offerFreedSlot(tx, fx, tenant, moved.freed);
    } else {
      booking = (
        await insertBooking(tx, fx, {
          tenant,
          leadId,
          customerId: lead.customerId,
          service: service ? { id: service.id, name: service.name } : null,
          startsAt,
          endsAt,
          source: "owner",
          actor,
        })
      ).row;
    }
    // A visit logged after the fact isn't news to the customer.
    const sent =
      input.notify && startsAt.getTime() > Date.now()
        ? await sendBookingMessage(tx, fx, {
            tenant,
            customer,
            booking,
            kind: current ? "moved" : "booked",
          })
        : [];
    if (sent.some((message) => message.status !== "blocked")) {
      await tx
        .update(bookings)
        .set({ confirmationSentAt: new Date() })
        .where(eq(bookings.id, booking.id));
    }
    return {
      booking: toBookingItem(booking, await wantsEarlier(tx, booking.id)),
      messages: sent.map(toMessageItem),
    };
  });
}

export async function ownerCancel(
  tenantId: string,
  userId: string,
  leadId: string,
  input: { reason: string; notify: boolean },
) {
  await tenantWork(tenantId, async (tx, fx) => {
    await lockBookings(tx, tenantId);
    const [row] = await tx
      .select({ booking: bookings, tenant: tenants })
      .from(bookings)
      .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
      .where(and(eq(bookings.leadId, leadId), eq(bookings.status, "booked")))
      .limit(1);
    if (!row) throw new HttpError(409, "no_booking", "There's no booked visit to cancel.");
    const { freed } = await cancelBooking(tx, fx, {
      tenant: row.tenant,
      booking: row.booking,
      by: "owner",
      reason: input.reason,
      actor: `user:${userId}`,
    });
    if (input.notify)
      await sendBookingMessage(tx, fx, {
        tenant: row.tenant,
        customer: await customerOf(tx, row.booking.customerId),
        booking: row.booking,
        kind: "canceled",
      });
    if (freed) await offerFreedSlot(tx, fx, row.tenant, freed);
  });
}

/** Module 8 "non-attendance": mark a no-show, keep the deposit if one is held, offer a new time. */
export async function markNoShow(
  tenantId: string,
  userId: string,
  bookingId: string,
  input: z.output<typeof noShowInput>,
) {
  const held = await tenantWork(tenantId, async (tx, fx) => {
    const [row] = await tx
      .select({ booking: bookings, tenant: tenants })
      .from(bookings)
      .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
      .where(eq(bookings.id, bookingId));
    if (!row) throw notFound("Booking");
    const { booking, tenant } = row;
    if (booking.status !== "booked")
      throw new HttpError(409, "not_booked", "This visit isn't booked any more.");
    if (booking.startsAt.getTime() > Date.now())
      throw new HttpError(409, "not_yet", "The visit hasn't started yet.");
    await tx.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, bookingId));
    // The job is open again with no visit, so the Schedule lists it under "Not booked yet".
    await tx
      .update(leads)
      .set({ scheduledFor: null })
      .where(and(eq(leads.id, booking.leadId), eq(leads.scheduledFor, booking.startsAt)));
    const holds = input.keepDeposit
      ? await tx
          .select({ id: paymentRequests.id })
          .from(paymentRequests)
          .where(
            and(eq(paymentRequests.leadId, booking.leadId), eq(paymentRequests.status, "held")),
          )
      : [];
    await addLeadEvent(tx, {
      tenantId,
      leadId: booking.leadId,
      type: "booking.no_show",
      actor: `user:${userId}`,
      data: {
        bookingId,
        startsAt: booking.startsAt.toISOString(),
        keepDeposit: holds.length > 0,
        rebookLink: input.sendRebookLink,
      },
    });
    if (input.sendRebookLink)
      await sendBookingMessage(tx, fx, {
        tenant,
        customer: await customerOf(tx, booking.customerId),
        booking,
        kind: "rebook",
      });
    fx.publish({ type: "lead.updated", leadId: booking.leadId });
    return holds;
  });
  // Card holds go through the payments provider, outside the transaction.
  for (const hold of held) await capturePayment(tenantId, userId, hold.id);
}

/**
 * Sets or clears a job's visit time without the clash check (the board's own "visit time" field).
 * Booking it again moves the existing booking; clearing it cancels the booking and frees the slot.
 */
export async function setVisit(
  tx: Tx,
  fx: Effects,
  input: { tenantId: string; leadId: string; startsAt: Date | null; actor: string },
) {
  const [row] = await tx
    .select({ lead: leads, tenant: tenants })
    .from(leads)
    .innerJoin(tenants, eq(tenants.id, leads.tenantId))
    .where(eq(leads.id, input.leadId));
  if (!row) throw notFound("Lead");
  const { lead, tenant } = row;
  await lockBookings(tx, input.tenantId);
  const [current] = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.leadId, input.leadId), eq(bookings.status, "booked")))
    .limit(1);
  if (!input.startsAt) {
    if (!current) return;
    const { freed } = await cancelBooking(tx, fx, {
      tenant,
      booking: current,
      by: "owner",
      reason: "",
      actor: input.actor,
    });
    if (freed) await offerFreedSlot(tx, fx, tenant, freed);
    return;
  }
  const length = current
    ? current.endsAt.getTime() - current.startsAt.getTime()
    : durationOf(null) * 60_000;
  const endsAt = new Date(input.startsAt.getTime() + length);
  if (current) {
    const moved = await moveBooking(tx, fx, {
      tenant,
      booking: current,
      startsAt: input.startsAt,
      endsAt,
      actor: input.actor,
    });
    await offerFreedSlot(tx, fx, tenant, moved.freed);
  } else {
    await insertBooking(tx, fx, {
      tenant,
      leadId: lead.id,
      customerId: lead.customerId,
      service: null,
      startsAt: input.startsAt,
      endsAt,
      source: "owner",
      actor: input.actor,
    });
  }
}

/** A job marked Won or Lost closes its visit: done, or cancelled with the slot freed. */
export async function closeBookingsForLead(
  tx: Tx,
  fx: Effects,
  input: { tenant: Tenant; leadId: string; outcome: "won" | "lost"; actor: string },
) {
  const open = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.leadId, input.leadId), eq(bookings.status, "booked")));
  for (const booking of open) {
    if (input.outcome === "won") {
      await tx.update(bookings).set({ status: "completed" }).where(eq(bookings.id, booking.id));
    } else {
      const { freed } = await cancelBooking(tx, fx, {
        tenant: input.tenant,
        booking,
        by: "owner",
        reason: "Job lost",
        actor: input.actor,
      });
      if (freed) await offerFreedSlot(tx, fx, input.tenant, freed);
    }
  }
}

/* ── Every 15 minutes: day-before reminders (C-20) and expired offers (C-22) ── */

export async function bookingsTickJob() {
  const now = Date.now();
  const due = await systemDb
    .select({ id: bookings.id, tenantId: bookings.tenantId })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "booked"),
        isNull(bookings.reminderSentAt),
        gt(bookings.startsAt, new Date(now + 3_600_000)),
        lt(bookings.startsAt, new Date(now + 24 * 3_600_000)),
        // Booked at least half a day ahead: a same-day booking's confirmation is reminder enough.
        lt(bookings.createdAt, sql`${bookings.startsAt} - interval '12 hours'`),
      ),
    )
    .limit(200);
  for (const row of due) {
    await sendReminder(row.tenantId, row.id).catch((error: unknown) =>
      logger.warn({ err: error, bookingId: row.id }, "booking reminder failed"),
    );
  }
  await systemDb
    .update(waitlistOffers)
    .set({ status: "expired" })
    .where(and(eq(waitlistOffers.status, "open"), lt(waitlistOffers.expiresAt, new Date(now))));
}

/** C-20: the day-before reminder, with YES to confirm or NO to cancel. */
export async function sendReminder(tenantId: string, bookingId: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [row] = await tx
      .select({ booking: bookings, tenant: tenants })
      .from(bookings)
      .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
      .where(eq(bookings.id, bookingId));
    if (!row || row.booking.status !== "booked") return;
    await tx.update(bookings).set({ reminderSentAt: new Date() }).where(eq(bookings.id, bookingId));
    await sendBookingMessage(tx, fx, {
      tenant: row.tenant,
      customer: await customerOf(tx, row.booking.customerId),
      booking: row.booking,
      kind: "reminder",
    });
    await addLeadEvent(tx, {
      tenantId,
      leadId: row.booking.leadId,
      type: "booking.reminded",
      actor: "system",
      data: { bookingId },
    });
    fx.publish({ type: "lead.updated", leadId: row.booking.leadId });
  });
}

/** Upcoming bookings of a customer that a reply could be about, newest prompt first. */
export async function promptedBookings(tx: Tx, customerId: string) {
  return tx
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.customerId, customerId),
        eq(bookings.status, "booked"),
        gt(bookings.startsAt, new Date()),
        isNotNull(bookings.tokenSealed),
      ),
    )
    .orderBy(asc(bookings.startsAt));
}
