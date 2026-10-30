import type { CalendarProviderName } from "@leadanchor/contracts";

/**
 * Calendar port (module 8: two-way sync with Google Calendar and Microsoft Outlook). Bookings
 * are written into the owner's calendar; everything else in it counts as busy, read through
 * the provider's incremental change feed (Google sync tokens, Microsoft delta links).
 */

export interface CalendarEventInput {
  /** Our booking: stored on the event so we can recognise it when it comes back in the feed. */
  bookingId: string;
  title: string;
  description: string;
  start: Date;
  end: Date;
}

export interface ExternalEvent {
  id: string;
  title: string | null;
  start: Date;
  end: Date;
  /** Set on events LeadAnchor created for a booking. */
  bookingId: string | null;
  /** Deleted (or declined) in the calendar. */
  cancelled: boolean;
}

export interface CalendarChanges {
  events: ExternalEvent[];
  nextSyncToken: string;
  /** The provider sent everything again (first sync, or the old token expired): drop what we had. */
  full: boolean;
}

/** A connected calendar as an adapter needs it: its account, and the credentials it was given. */
export interface CalendarConnection {
  account: string;
  credentials: string | null;
}

/** The provider no longer accepts LeadAnchor's access (revoked or expired): the owner connects again. */
export class CalendarAuthExpired extends Error {
  constructor() {
    super("The calendar connection has ended.");
    this.name = "CalendarAuthExpired";
  }
}

/** Connecting didn't work out, for a reason the owner can act on. */
export class CalendarConnectRefused extends Error {
  constructor(readonly reason: "no_access" | "no_offline" | "failed") {
    super(`Calendar connection refused: ${reason}`);
    this.name = "CalendarConnectRefused";
  }
}

export interface CalendarProvider {
  readonly name: CalendarProviderName;
  /** Where to send the owner to allow access (OAuth), or null when no sign-in is needed. */
  authorizeUrl(state: string, redirectUri: string): string | null;
  /** Finishes connecting: the calendar's name, plus the credentials to keep (encrypted). */
  finishConnect(input: {
    tenantId: string;
    businessName: string;
    code: string | null;
    redirectUri: string;
  }): Promise<{ account: string; credentials: string | null }>;
  upsertEvent(
    connection: CalendarConnection,
    eventId: string | null,
    input: CalendarEventInput,
  ): Promise<{ eventId: string }>;
  deleteEvent(connection: CalendarConnection, eventId: string): Promise<void>;
  /** Changes since `syncToken` (or everything from `from` when it's null). */
  changes(
    connection: CalendarConnection,
    syncToken: string | null,
    window: { from: Date; to: Date },
  ): Promise<CalendarChanges>;
}
