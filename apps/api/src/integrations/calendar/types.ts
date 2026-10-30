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
    account: string,
    eventId: string | null,
    input: CalendarEventInput,
  ): Promise<{ eventId: string }>;
  deleteEvent(account: string, eventId: string): Promise<void>;
  /** Changes since `syncToken` (or everything from `from` when it's null). */
  changes(
    account: string,
    syncToken: string | null,
    window: { from: Date; to: Date },
  ): Promise<CalendarChanges>;
}
