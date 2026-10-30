import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  CalendarChanges,
  CalendarConnection,
  CalendarEventInput,
  CalendarProvider,
  ExternalEvent,
} from "./types";

interface SimEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  bookingId: string | null;
  deleted: boolean;
  /** The change number that last touched it, for the incremental feed. */
  version: number;
}

interface SimCalendar {
  name: string;
  version: number;
  events: Record<string, SimEvent>;
}

type Store = Record<string, SimCalendar>;

const newId = () => `evt_sim_${randomBytes(8).toString("hex")}`;

/**
 * A stand-in for Google Calendar and Outlook while they aren't set up: one calendar per
 * business, kept in a file, with the same change feed a real provider has (a sync token that
 * returns only what changed). The owner can add or move "personal" events from the simulator
 * page, to see busy times block bookings and clashes get flagged.
 */
export class SimulatorCalendar implements CalendarProvider {
  readonly name = "simulator" as const;
  private cache: Store | null = null;

  constructor(private readonly file: string) {}

  authorizeUrl() {
    return null;
  }

  async finishConnect(input: { tenantId: string; businessName: string }) {
    const account = `sim-${input.tenantId}`;
    this.write(
      (store) =>
        (store[account] ??= {
          name: `${input.businessName} (simulated calendar)`,
          version: 0,
          events: {},
        }),
    );
    return { account, credentials: null };
  }

  async upsertEvent(
    { account }: CalendarConnection,
    eventId: string | null,
    input: CalendarEventInput,
  ) {
    const id = eventId && this.calendar(this.read(), account).events[eventId] ? eventId : newId();
    this.write((store) => {
      const calendar = this.calendar(store, account);
      calendar.version += 1;
      calendar.events[id] = {
        id,
        title: input.title,
        start: input.start.toISOString(),
        end: input.end.toISOString(),
        bookingId: input.bookingId,
        deleted: false,
        version: calendar.version,
      };
    });
    return { eventId: id };
  }

  async deleteEvent({ account }: CalendarConnection, eventId: string) {
    this.write((store) => {
      const calendar = this.calendar(store, account);
      const event = calendar.events[eventId];
      if (!event || event.deleted) return;
      calendar.version += 1;
      event.deleted = true;
      event.version = calendar.version;
    });
  }

  async changes(
    { account }: CalendarConnection,
    syncToken: string | null,
    window: { from: Date; to: Date },
  ): Promise<CalendarChanges> {
    const calendar = this.calendar(this.read(), account);
    const since = syncToken === null ? null : Number(syncToken);
    const full = since === null || Number.isNaN(since) || since > calendar.version;
    const events = Object.values(calendar.events)
      .filter((event) =>
        full
          ? !event.deleted &&
            Date.parse(event.end) > window.from.getTime() &&
            Date.parse(event.start) < window.to.getTime()
          : event.version > since!,
      )
      .map(toExternal);
    return { events, nextSyncToken: String(calendar.version), full };
  }

  /* ── The simulator page: the owner's own edits, as if made in Google Calendar ── */

  list(account: string) {
    const calendar = this.read()[account];
    if (!calendar) return null;
    return Object.values(calendar.events)
      .filter((event) => !event.deleted)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map(toExternal);
  }

  addPersonal(account: string, input: { title: string; start: Date; end: Date }) {
    const id = newId();
    this.write((store) => {
      const calendar = this.calendar(store, account);
      calendar.version += 1;
      calendar.events[id] = {
        id,
        title: input.title,
        start: input.start.toISOString(),
        end: input.end.toISOString(),
        bookingId: null,
        deleted: false,
        version: calendar.version,
      };
    });
    return id;
  }

  move(account: string, eventId: string, start: Date, end: Date) {
    this.write((store) => {
      const calendar = this.calendar(store, account);
      const event = calendar.events[eventId];
      if (!event || event.deleted) return;
      calendar.version += 1;
      Object.assign(event, {
        start: start.toISOString(),
        end: end.toISOString(),
        version: calendar.version,
      });
    });
  }

  remove(account: string, eventId: string) {
    return this.deleteEvent({ account, credentials: null }, eventId);
  }

  private calendar(store: Store, account: string) {
    const calendar = store[account];
    if (!calendar) throw new Error("That calendar isn't connected.");
    return calendar;
  }

  private read(): Store {
    if (this.cache) return this.cache;
    this.cache = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, "utf8")) as Store)
      : {};
    return this.cache;
  }

  private write(change: (store: Store) => void) {
    const store = this.read();
    change(store);
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(store, null, 2));
    renameSync(temp, this.file);
  }
}

function toExternal(event: SimEvent): ExternalEvent {
  return {
    id: event.id,
    title: event.title,
    start: new Date(event.start),
    end: new Date(event.end),
    bookingId: event.bookingId,
    cancelled: event.deleted,
  };
}
