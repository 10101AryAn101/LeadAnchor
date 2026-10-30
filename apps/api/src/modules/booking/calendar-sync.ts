import type { CalendarProviderName, CalendarStatus, SimCalendarEvent } from "@leadanchor/contracts";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { calendarProviders, simulatorCalendar } from "../../container";
import { type Tx, systemDb, withTenant } from "../../db/client";
import { bookings, calendarConnections, calendarEvents, customers, tenants } from "../../db/schema";
import { type Effects, tenantWork } from "../../db/unit-of-work";
import { QUEUES } from "../../jobs/queue";
import { encryptSecret } from "../../lib/crypto";
import { HttpError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { iso } from "../../lib/time";
import { friendlyTime } from "../../lib/zoned";
import { audit } from "../compliance/audit";
import { addLeadEvent } from "../leads/lead-capture";
import { notifyOwner } from "../notifications/notify";
import { overlaps } from "./availability";

const DAY_MS = 86_400_000;
/** How far ahead the calendar is read: the longest booking window, with room to spare. */
const SYNC_AHEAD_DAYS = 90;

const realProviders = () => Boolean(calendarProviders.google || calendarProviders.microsoft);

export async function calendarStatusOf(tx: Tx): Promise<CalendarStatus> {
  const [connection] = await tx.select().from(calendarConnections).limit(1);
  return {
    provider: connection?.provider ?? null,
    connected: Boolean(connection),
    account: connection
      ? connection.provider === "simulator"
        ? "the simulated calendar"
        : connection.account
      : null,
    lastSyncedAt: iso(connection?.lastSyncedAt),
    error: connection?.lastError ?? null,
    simulated: !realProviders(),
  };
}

/**
 * Connects the business's calendar (module 8). Google and Microsoft send the owner to sign in
 * first (step 2); the simulator connects straight away. Existing bookings are then written to it.
 */
export async function connectCalendar(
  tenantId: string,
  userId: string,
  provider: CalendarProviderName,
  redirectUri: string,
): Promise<{ url: string | null }> {
  const adapter = calendarProviders[provider];
  if (!adapter) throw new HttpError(409, "not_available", "That calendar can't be connected yet.");
  const signIn = adapter.authorizeUrl(tenantId, redirectUri);
  if (signIn) return { url: signIn };

  const [tenant] = await withTenant(tenantId, (tx) =>
    tx.select().from(tenants).where(eq(tenants.id, tenantId)),
  );
  const { account, credentials } = await adapter.finishConnect({
    tenantId,
    businessName: tenant!.name,
    code: null,
    redirectUri,
  });
  await tenantWork(tenantId, async (tx, fx) => {
    const values = {
      provider,
      account,
      credentialsSealed: credentials ? encryptSecret(credentials) : null,
      syncToken: null,
      lastError: null,
    };
    await tx
      .insert(calendarConnections)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: calendarConnections.tenantId, set: values });
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "calendar.connected",
      entityType: "calendar",
      entityId: tenantId,
      data: { provider },
    });
    const upcoming = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.status, "booked"), gt(bookings.startsAt, new Date())));
    for (const booking of upcoming)
      fx.enqueue(QUEUES.calendarPush, { tenantId, bookingId: booking.id });
    fx.publish({ type: "settings.updated" });
  });
  await syncCalendar(tenantId);
  return { url: null };
}

export async function disconnectCalendar(tenantId: string, userId: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    await tx.delete(calendarConnections);
    await tx
      .update(bookings)
      .set({ calendarEventId: null, calendarConflict: null })
      .where(eq(bookings.tenantId, tenantId));
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "calendar.disconnected",
      entityType: "calendar",
      entityId: tenantId,
    });
    fx.publish({ type: "settings.updated" });
  });
}

async function connectionOf(tenantId: string) {
  const [connection] = await withTenant(tenantId, (tx) =>
    tx.select().from(calendarConnections).limit(1),
  );
  return connection ?? null;
}

/** Writes one booking into the calendar, or takes it out once it isn't booked any more. */
export async function pushBookingJob(data: { tenantId: string; bookingId: string }) {
  const connection = await connectionOf(data.tenantId);
  const adapter = connection ? calendarProviders[connection.provider] : undefined;
  if (!connection?.account || !adapter) return;
  const [row] = await withTenant(data.tenantId, (tx) =>
    tx
      .select({ booking: bookings, customer: customers })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(eq(bookings.id, data.bookingId)),
  );
  if (!row) return;
  const { booking, customer } = row;

  if (booking.status === "booked") {
    const { eventId } = await adapter.upsertEvent(connection.account, booking.calendarEventId, {
      bookingId: booking.id,
      title: `${booking.serviceName ?? "Visit"}: ${customer.name ?? customer.phoneE164 ?? "customer"}`,
      description: `Booked in LeadAnchor.${customer.phoneE164 ? ` Phone ${customer.phoneE164}.` : ""}`,
      start: booking.startsAt,
      end: booking.endsAt,
    });
    await withTenant(data.tenantId, async (tx) => {
      await tx
        .update(bookings)
        .set({ calendarEventId: eventId })
        .where(eq(bookings.id, booking.id));
      const mirror = {
        title: null,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        bookingId: booking.id,
      };
      await tx
        .insert(calendarEvents)
        .values({
          tenantId: data.tenantId,
          connectionId: connection.id,
          externalId: eventId,
          ...mirror,
        })
        .onConflictDoUpdate({
          target: [calendarEvents.connectionId, calendarEvents.externalId],
          set: mirror,
        });
    });
  } else if (booking.calendarEventId) {
    await adapter.deleteEvent(connection.account, booking.calendarEventId);
    await withTenant(data.tenantId, async (tx) => {
      await tx
        .delete(calendarEvents)
        .where(
          and(
            eq(calendarEvents.connectionId, connection.id),
            eq(calendarEvents.externalId, booking.calendarEventId!),
          ),
        );
      await tx.update(bookings).set({ calendarEventId: null }).where(eq(bookings.id, booking.id));
    });
  }
}

/**
 * Reads what changed in the calendar since last time (incremental sync). Everything that isn't
 * one of our bookings becomes busy time; a clash with a booked visit is flagged to the owner,
 * as is one of our booking events being moved or deleted from the calendar's side.
 */
export async function syncCalendar(tenantId: string) {
  const connection = await connectionOf(tenantId);
  const adapter = connection ? calendarProviders[connection.provider] : undefined;
  if (!connection?.account || !adapter) return;
  try {
    const now = Date.now();
    const changes = await adapter.changes(connection.account, connection.syncToken, {
      from: new Date(now - DAY_MS),
      to: new Date(now + SYNC_AHEAD_DAYS * DAY_MS),
    });
    await tenantWork(tenantId, async (tx, fx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
      const notes = new Map<string, string>();
      if (changes.full)
        await tx.delete(calendarEvents).where(eq(calendarEvents.connectionId, connection.id));
      for (const event of changes.events) {
        const own = event.bookingId
          ? (
              await tx
                .select()
                .from(bookings)
                .where(
                  and(
                    eq(bookings.id, event.bookingId),
                    eq(bookings.calendarEventId, event.id),
                    eq(bookings.status, "booked"),
                  ),
                )
            )[0]
          : undefined;
        if (event.cancelled) {
          await tx
            .delete(calendarEvents)
            .where(
              and(
                eq(calendarEvents.connectionId, connection.id),
                eq(calendarEvents.externalId, event.id),
              ),
            );
          if (own)
            notes.set(
              own.id,
              "Its event was deleted from your calendar, but the customer still expects you.",
            );
          continue;
        }
        const mirror = {
          title: event.title,
          startsAt: event.start,
          endsAt: event.end,
          bookingId: own ? own.id : null,
        };
        await tx
          .insert(calendarEvents)
          .values({ tenantId, connectionId: connection.id, externalId: event.id, ...mirror })
          .onConflictDoUpdate({
            target: [calendarEvents.connectionId, calendarEvents.externalId],
            set: mirror,
          });
        if (own && own.startsAt.getTime() !== event.start.getTime()) {
          notes.set(
            own.id,
            `It was moved to ${friendlyTime(event.start, tenant!.timezone)} in your calendar; the customer still expects ${friendlyTime(own.startsAt, tenant!.timezone)}.`,
          );
        }
      }
      await flagClashes(tx, fx, tenant!, notes);
      await tx
        .update(calendarConnections)
        .set({ syncToken: changes.nextSyncToken, lastSyncedAt: new Date(), lastError: null })
        .where(eq(calendarConnections.id, connection.id));
      fx.publish({ type: "settings.updated" });
    });
  } catch (error) {
    logger.warn({ err: error, tenantId }, "calendar sync failed");
    await withTenant(tenantId, (tx) =>
      tx
        .update(calendarConnections)
        .set({ lastError: "We couldn't read your calendar. We'll keep trying." })
        .where(eq(calendarConnections.id, connection.id)),
    );
  }
}

/** Marks booked visits that clash with the owner's calendar, tells the owner once, and clears what's resolved. */
async function flagClashes(
  tx: Tx,
  fx: Effects,
  tenant: typeof tenants.$inferSelect,
  notes: Map<string, string>,
) {
  const from = new Date(Date.now() - DAY_MS);
  const [upcoming, busy] = await Promise.all([
    tx
      .select({ booking: bookings, name: customers.name })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(and(eq(bookings.status, "booked"), gt(bookings.endsAt, from))),
    tx
      .select()
      .from(calendarEvents)
      .where(
        and(
          isNull(calendarEvents.bookingId),
          gt(calendarEvents.endsAt, from),
          lt(calendarEvents.startsAt, new Date(Date.now() + SYNC_AHEAD_DAYS * DAY_MS)),
        ),
      ),
  ]);
  for (const { booking, name } of upcoming) {
    const clash = busy.find((event) =>
      overlaps(
        { start: event.startsAt, end: event.endsAt },
        { start: booking.startsAt, end: booking.endsAt },
      ),
    );
    const note =
      notes.get(booking.id) ??
      (clash ? `“${clash.title ?? "Busy"}” in your calendar overlaps this visit.` : null);
    if (note === booking.calendarConflict) continue;
    await tx.update(bookings).set({ calendarConflict: note }).where(eq(bookings.id, booking.id));
    if (note) {
      await addLeadEvent(tx, {
        tenantId: tenant.id,
        leadId: booking.leadId,
        type: "booking.conflict",
        actor: "system",
        data: { bookingId: booking.id, note },
      });
      await notifyOwner(tx, fx, {
        tenantId: tenant.id,
        kind: "booking",
        title: "Calendar clash",
        body: `${name ?? "A customer"}, ${friendlyTime(booking.startsAt, tenant.timezone)}: ${note}`,
        leadId: booking.leadId,
      });
    }
    fx.publish({ type: "lead.updated", leadId: booking.leadId });
  }
}

/** Every 5 minutes: catch up every connected calendar. */
export async function calendarSyncTickJob() {
  const connections = await systemDb
    .select({ tenantId: calendarConnections.tenantId })
    .from(calendarConnections);
  for (const connection of connections) await syncCalendar(connection.tenantId);
}

/* ── The simulated calendar page (development): edits as if made in Google Calendar ── */

async function simulatedAccount(tenantId: string) {
  const connection = await connectionOf(tenantId);
  if (connection?.provider !== "simulator" || !connection.account)
    throw new HttpError(
      409,
      "not_connected",
      "Connect the simulated calendar first (Settings → Online booking).",
    );
  return connection.account;
}

export async function simulatedCalendarEvents(tenantId: string): Promise<SimCalendarEvent[]> {
  const events = simulatorCalendar.list(await simulatedAccount(tenantId)) ?? [];
  return events
    .filter((event) => event.end.getTime() > Date.now() - DAY_MS)
    .map((event) => ({
      id: event.id,
      title: event.title ?? "Busy",
      startsAt: event.start.toISOString(),
      endsAt: event.end.toISOString(),
      fromLeadAnchor: Boolean(event.bookingId),
    }));
}

export async function addSimulatedEvent(
  tenantId: string,
  input: { title: string; startsAt: string; endsAt: string },
) {
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  if (!(end > start))
    throw new HttpError(422, "validation_failed", "The end must be after the start.", {
      endsAt: ["Pick a later end time"],
    });
  simulatorCalendar.addPersonal(await simulatedAccount(tenantId), {
    title: input.title,
    start,
    end,
  });
  await syncCalendar(tenantId);
}

export async function moveSimulatedEvent(
  tenantId: string,
  eventId: string,
  input: { startsAt: string; endsAt: string },
) {
  simulatorCalendar.move(
    await simulatedAccount(tenantId),
    eventId,
    new Date(input.startsAt),
    new Date(input.endsAt),
  );
  await syncCalendar(tenantId);
}

export async function removeSimulatedEvent(tenantId: string, eventId: string) {
  await simulatorCalendar.remove(await simulatedAccount(tenantId), eventId);
  await syncCalendar(tenantId);
}
