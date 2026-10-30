import {
  type BookingCanceler,
  type BookingItem,
  type BookingSettings,
  type BookingSource,
  DEFAULT_SERVICE_MINUTES,
  type RequestSource,
  defaultBookingSettings,
} from "@leadanchor/contracts";
import { and, desc, eq, gt, inArray, isNull, lt, ne, notExists, sql } from "drizzle-orm";
import { linkBaseUrl } from "../../config/env";
import type { Tx } from "../../db/client";
import {
  bookings,
  calendarEvents,
  customers,
  leads,
  services,
  type tenants,
  waitlistEntries,
} from "../../db/schema";
import type { Effects } from "../../db/unit-of-work";
import { QUEUES } from "../../jobs/queue";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../../lib/crypto";
import { HttpError } from "../../lib/errors";
import { iso } from "../../lib/time";
import { friendlyTime } from "../../lib/zoned";
import { upsertCustomerByPhone } from "../customers/customer.repo";
import { addLeadEvent, topPosition } from "../leads/lead-capture";
import { advanceLead } from "../leads/pipeline";
import { requestEmail, requestMessage } from "../messaging/send-path";
import { type Interval, overlaps } from "./availability";

export type Tenant = typeof tenants.$inferSelect;
export type BookingRow = typeof bookings.$inferSelect;
type Customer = typeof customers.$inferSelect;

/** The public booking page (C-18): share it, put it on the website button or the Google profile. */
export const bookingUrl = (slug: string) => `${linkBaseUrl}/b/${slug}`;
/** The customer's own page to change or cancel a booking. */
export const manageUrl = (token: string) => `${linkBaseUrl}/b/manage/${token}`;

/** Saved settings over the defaults, so a setting added later has a value for everyone. */
export const settingsOf = (tenant: Pick<Tenant, "booking" | "track">): BookingSettings => ({
  ...defaultBookingSettings(tenant.track),
  ...tenant.booking,
});

export const durationOf = (service: { durationMins: number | null } | null | undefined) =>
  service?.durationMins ?? DEFAULT_SERVICE_MINUTES;

export function linkOf(row: Pick<BookingRow, "tokenSealed">) {
  if (!row.tokenSealed) return null;
  try {
    return manageUrl(decryptSecret(row.tokenSealed));
  } catch {
    return null;
  }
}

/** Visits set before online booking existed get their customer link with the first message about them. */
async function ensureLink(tx: Tx, booking: BookingRow) {
  const link = linkOf(booking);
  if (link) return link;
  const token = randomToken();
  await tx
    .update(bookings)
    .set({ tokenHash: sha256(token), tokenSealed: encryptSecret(token) })
    .where(eq(bookings.id, booking.id));
  return manageUrl(token);
}

/** One booking at a time per business: whoever holds this lock sees every slot as it really is. */
export async function lockBookings(tx: Tx, tenantId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`bookings:${tenantId}`}))`);
}

/** Booked visits and the owner's own calendar events between two instants. */
export async function busyBetween(
  tx: Tx,
  from: Date,
  to: Date,
  exceptBookingId?: string,
): Promise<Array<Interval & { label: string }>> {
  const [booked, events] = await Promise.all([
    tx
      .select({
        start: bookings.startsAt,
        end: bookings.endsAt,
        name: customers.name,
        service: bookings.serviceName,
      })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(
        and(
          eq(bookings.status, "booked"),
          lt(bookings.startsAt, to),
          gt(bookings.endsAt, from),
          exceptBookingId ? ne(bookings.id, exceptBookingId) : undefined,
        ),
      ),
    // LeadAnchor's own events stand for bookings that are already counted above.
    tx
      .select({
        start: calendarEvents.startsAt,
        end: calendarEvents.endsAt,
        title: calendarEvents.title,
      })
      .from(calendarEvents)
      .where(
        and(
          lt(calendarEvents.startsAt, to),
          gt(calendarEvents.endsAt, from),
          isNull(calendarEvents.bookingId),
        ),
      ),
  ]);
  return [
    ...booked.map((row) => ({
      start: row.start,
      end: row.end,
      label: `${row.name ?? "a customer"}${row.service ? ` (${row.service})` : ""}`,
    })),
    ...events.map((row) => ({
      start: row.start,
      end: row.end,
      label: `“${row.title ?? "Busy"}” in your calendar`,
    })),
  ];
}

export async function wantsEarlier(tx: Tx, bookingId: string) {
  const [entry] = await tx
    .select({ id: waitlistEntries.id })
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.bookingId, bookingId), eq(waitlistEntries.status, "waiting")))
    .limit(1);
  return Boolean(entry);
}

export function toBookingItem(row: BookingRow, earlier: boolean): BookingItem {
  return {
    id: row.id,
    leadId: row.leadId,
    service: row.serviceId && row.serviceName ? { id: row.serviceId, name: row.serviceName } : null,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    source: row.source,
    confirmedAt: iso(row.confirmedAt),
    confirmationSentAt: iso(row.confirmationSentAt),
    reminderSentAt: iso(row.reminderSentAt),
    canceledAt: iso(row.canceledAt),
    canceledBy: row.canceledBy,
    cancelReason: row.cancelReason,
    calendarConflict: row.calendarConflict,
    manageUrl: linkOf(row),
    wantsEarlier: earlier,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The lead a new booking belongs to: an open one from the last day without a visit, or a new card. */
export async function leadForBooking(
  tx: Tx,
  fx: Effects,
  input: {
    tenant: Tenant;
    phone: string;
    name: string;
    email: string | null;
    title: string;
    estimateCents: number | null;
    channel: RequestSource;
  },
) {
  const customer = await upsertCustomerByPhone(tx, input.tenant.id, input.phone, {
    name: input.name,
    email: input.email,
  });
  const [open] = await tx
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.customerId, customer.id),
        inArray(leads.stage, ["new", "contacted", "quoted"]),
        gt(leads.lastActivityAt, new Date(Date.now() - 86_400_000)),
        notExists(
          tx
            .select({ id: bookings.id })
            .from(bookings)
            .where(and(eq(bookings.leadId, leads.id), eq(bookings.status, "booked"))),
        ),
      ),
    )
    .orderBy(desc(leads.lastActivityAt))
    .limit(1);
  if (open) return { customer, lead: open };
  const [lead] = await tx
    .insert(leads)
    .values({
      tenantId: input.tenant.id,
      customerId: customer.id,
      // Like the request form: what comes from the Google profile is marked Google (C-10).
      source: input.channel === "google" ? "google" : "booking",
      title: input.title,
      needsCallback: false,
      estimatedValueCents: input.estimateCents ?? input.tenant.avgJobValueCents,
      position: await topPosition(tx, input.tenant.id, "new"),
    })
    .returning();
  fx.publish({ type: "lead.created", leadId: lead!.id });
  return { customer, lead: lead! };
}

/** Writes a booking and puts its time on the card (which moves it to Scheduled). Call under lockBookings. */
export async function insertBooking(
  tx: Tx,
  fx: Effects,
  input: {
    tenant: Tenant;
    leadId: string;
    customerId: string;
    service: { id: string; name: string } | null;
    startsAt: Date;
    endsAt: Date;
    source: BookingSource;
    /** Which way the customer came in: the website button, the Google profile or a shared link. */
    channel?: RequestSource;
    notes?: string | null;
    actor: string;
  },
) {
  const token = randomToken();
  const [row] = await tx
    .insert(bookings)
    .values({
      tenantId: input.tenant.id,
      leadId: input.leadId,
      customerId: input.customerId,
      serviceId: input.service?.id ?? null,
      serviceName: input.service?.name ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      source: input.source,
      notes: input.notes || null,
      tokenHash: sha256(token),
      tokenSealed: encryptSecret(token),
      createdBy: input.actor,
    })
    .returning();
  await tx
    .update(leads)
    .set({
      scheduledFor: input.startsAt,
      needsCallback: false,
      ...(input.service && { serviceCategory: input.service.name }),
    })
    .where(eq(leads.id, input.leadId));
  await addLeadEvent(tx, {
    tenantId: input.tenant.id,
    leadId: input.leadId,
    type: "booking.created",
    actor: input.actor,
    data: {
      bookingId: row!.id,
      startsAt: input.startsAt.toISOString(),
      service: input.service?.name ?? null,
      source: input.source,
      channel: input.channel ?? null,
    },
  });
  await advanceLead(tx, fx, {
    tenantId: input.tenant.id,
    leadId: input.leadId,
    reason: input.source === "owner" ? "visit_booked" : "booked_online",
  });
  fx.enqueue(QUEUES.calendarPush, { tenantId: input.tenant.id, bookingId: row!.id });
  fx.publish({ type: "lead.updated", leadId: input.leadId });
  return { row: row!, token };
}

/** Moves a booking to a new time. Returns the slot it left, for the waitlist. Call under lockBookings. */
export async function moveBooking(
  tx: Tx,
  fx: Effects,
  input: { tenant: Tenant; booking: BookingRow; startsAt: Date; endsAt: Date; actor: string },
) {
  const { booking } = input;
  const [row] = await tx
    .update(bookings)
    .set({
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reminderSentAt: null,
      confirmedAt: null,
      calendarConflict: null,
    })
    .where(eq(bookings.id, booking.id))
    .returning();
  await tx.update(leads).set({ scheduledFor: input.startsAt }).where(eq(leads.id, booking.leadId));
  await addLeadEvent(tx, {
    tenantId: input.tenant.id,
    leadId: booking.leadId,
    type: "booking.moved",
    actor: input.actor,
    data: {
      bookingId: booking.id,
      from: booking.startsAt.toISOString(),
      to: input.startsAt.toISOString(),
      service: booking.serviceName,
    },
  });
  // Wanting an earlier time only makes sense before the new one.
  await tx
    .update(waitlistEntries)
    .set({ windowEnd: input.startsAt })
    .where(and(eq(waitlistEntries.bookingId, booking.id), eq(waitlistEntries.status, "waiting")));
  fx.enqueue(QUEUES.calendarPush, { tenantId: input.tenant.id, bookingId: booking.id });
  fx.publish({ type: "lead.updated", leadId: booking.leadId });
  return { row: row!, freed: freedSlot(booking) };
}

/** Cancels a booking and frees its slot. Returns the slot, for the waitlist. */
export async function cancelBooking(
  tx: Tx,
  fx: Effects,
  input: {
    tenant: Tenant;
    booking: BookingRow;
    by: BookingCanceler;
    reason: string;
    actor: string;
  },
) {
  const { booking } = input;
  const [row] = await tx
    .update(bookings)
    .set({
      status: "canceled",
      canceledAt: new Date(),
      canceledBy: input.by,
      cancelReason: input.reason || null,
    })
    .where(eq(bookings.id, booking.id))
    .returning();
  await tx
    .update(leads)
    .set({ scheduledFor: null })
    .where(and(eq(leads.id, booking.leadId), eq(leads.scheduledFor, booking.startsAt)));
  await tx
    .update(waitlistEntries)
    .set({ status: "removed" })
    .where(and(eq(waitlistEntries.bookingId, booking.id), eq(waitlistEntries.status, "waiting")));
  await addLeadEvent(tx, {
    tenantId: input.tenant.id,
    leadId: booking.leadId,
    type: "booking.canceled",
    actor: input.actor,
    data: {
      bookingId: booking.id,
      by: input.by,
      reason: input.reason || null,
      startsAt: booking.startsAt.toISOString(),
      service: booking.serviceName,
    },
  });
  fx.enqueue(QUEUES.calendarPush, { tenantId: input.tenant.id, bookingId: booking.id });
  fx.publish({ type: "lead.updated", leadId: booking.leadId });
  return { row: row!, freed: booking.startsAt.getTime() > Date.now() ? freedSlot(booking) : null };
}

export interface FreedSlot {
  start: Date;
  end: Date;
  serviceId: string | null;
  serviceName: string | null;
  customerId: string;
}

const freedSlot = (booking: BookingRow): FreedSlot => ({
  start: booking.startsAt,
  end: booking.endsAt,
  serviceId: booking.serviceId,
  serviceName: booking.serviceName,
  customerId: booking.customerId,
});

/** Throws when [start, end] (plus the buffer) clashes with a booking or the owner's calendar. */
export async function assertFree(
  tx: Tx,
  input: { start: Date; end: Date; bufferMins: number; exceptBookingId?: string },
) {
  const buffer = input.bufferMins * 60_000;
  const needed = {
    start: new Date(input.start.getTime() - buffer),
    end: new Date(input.end.getTime() + buffer),
  };
  const clash = (await busyBetween(tx, needed.start, needed.end, input.exceptBookingId)).find(
    (busy) => overlaps(needed, busy),
  );
  if (clash) throw new HttpError(409, "slot_taken", `That time clashes with ${clash.label}.`);
}

type BookingMessage = "booked" | "moved" | "canceled" | "reminder" | "rebook";

/**
 * C-19 / C-20: the texts (and emails) about a booking, all through the governed send path.
 * Texts need the customer's consent and carrier approval; email goes when they gave an address.
 */
export async function sendBookingMessage(
  tx: Tx,
  fx: Effects,
  input: {
    tenant: Tenant;
    customer: Customer;
    booking: BookingRow;
    kind: BookingMessage;
    text?: boolean;
    email?: boolean;
  },
) {
  const { tenant, customer, booking } = input;
  const first = customer.name?.trim().split(/\s+/)[0];
  const hi = first ? `Hi ${first}` : "Hi";
  const what = booking.serviceName ?? "your visit";
  const when = friendlyTime(booking.startsAt, tenant.timezone);
  const link =
    input.kind === "canceled" || input.kind === "rebook" ? null : await ensureLink(tx, booking);
  const lines: Record<BookingMessage, { text: string; subject: string }> = {
    booked: {
      text: `${hi}, you're booked with ${tenant.name}: ${what}, ${when}.${link ? ` To change or cancel: ${link}` : ""}\nReply STOP to opt out.`,
      subject: `Booked: ${what} with ${tenant.name}`,
    },
    moved: {
      text: `${hi}, your ${what} with ${tenant.name} is now ${when}.${link ? ` To change or cancel: ${link}` : ""}`,
      subject: `New time: ${what} with ${tenant.name}`,
    },
    canceled: {
      text: `${hi}, your ${what} with ${tenant.name} on ${when} is cancelled. Book again any time: ${bookingUrl(tenant.slug)}`,
      subject: `Cancelled: ${what} with ${tenant.name}`,
    },
    reminder: {
      text: `Reminder from ${tenant.name}: ${what}, ${when}. Reply YES to confirm or NO to cancel.${link ? ` To change it: ${link}` : ""}`,
      subject: `Reminder: ${what} with ${tenant.name}, ${when}`,
    },
    rebook: {
      text: `${hi}, sorry we missed you. Book a new time with ${tenant.name} here: ${bookingUrl(tenant.slug)}`,
      subject: `Book a new time with ${tenant.name}`,
    },
  };
  const message = lines[input.kind];
  const sent = [];
  if ((input.text ?? true) && customer.phoneE164) {
    sent.push(
      await requestMessage(tx, fx, {
        tenant,
        customerId: customer.id,
        leadId: booking.leadId,
        to: customer.phoneE164,
        purpose: "transactional",
        body: message.text,
      }),
    );
  }
  if ((input.email ?? true) && customer.email) {
    sent.push(
      await requestEmail(tx, fx, {
        tenant,
        customerId: customer.id,
        leadId: booking.leadId,
        to: customer.email,
        purpose: "transactional",
        subject: message.subject,
        body: `${message.text.replace("\nReply STOP to opt out.", "").replace(" Reply YES to confirm or NO to cancel.", "")}\n\n${tenant.name}`,
      }),
    );
  }
  return sent;
}

export async function customerOf(tx: Tx, customerId: string) {
  const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId));
  return customer!;
}

export async function serviceOf(tx: Tx, serviceId: string | null | undefined) {
  if (!serviceId) return null;
  const [service] = await tx.select().from(services).where(eq(services.id, serviceId));
  return service ?? null;
}
