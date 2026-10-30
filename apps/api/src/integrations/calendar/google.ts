import {
  type CalendarChanges,
  type CalendarConnection,
  type CalendarEventInput,
  type CalendarProvider,
  CalendarAuthExpired,
  CalendarConnectRefused,
  type ExternalEvent,
} from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
/** Kept on every event we create, so we know our bookings when they come back in the feed. */
const BOOKING_KEY = "leadanchorBookingId";

interface Credentials {
  refreshToken: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  extendedProperties?: { private?: Record<string, string> };
}

/**
 * Google Calendar (module 8). Bookings go into the owner's primary calendar, and everything else
 * in it is read back as busy time through Google's sync tokens (only what changed since last
 * time). OAuth with offline access; the refresh token is the credential the caller keeps
 * encrypted. While the Google app is in "Testing", Google ends the connection after 7 days and
 * the owner connects again.
 */
export class GoogleCalendar implements CalendarProvider {
  readonly name = "google" as const;
  private readonly accessTokens = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  authorizeUrl(state: string, redirectUri: string) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: `openid email ${EVENTS_SCOPE}`,
      // A refresh token, so syncing carries on while the owner is away.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `${AUTH_URL}?${params}`;
  }

  async finishConnect(input: { code: string | null; redirectUri: string }) {
    if (!input.code) throw new CalendarConnectRefused("failed");
    const token = await this.tokenRequest({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    }).catch((error: unknown) => {
      throw error instanceof CalendarAuthExpired ? new CalendarConnectRefused("failed") : error;
    });
    // Google lets people untick the calendar box on its consent screen.
    if (!token.scope?.split(" ").includes(EVENTS_SCOPE))
      throw new CalendarConnectRefused("no_access");
    if (!token.refresh_token) throw new CalendarConnectRefused("no_offline");
    this.remember(token.refresh_token, token);
    const credentials: Credentials = { refreshToken: token.refresh_token };
    return {
      account: emailOf(token.id_token) ?? "your Google Calendar",
      credentials: JSON.stringify(credentials),
    };
  }

  async upsertEvent(
    connection: CalendarConnection,
    eventId: string | null,
    input: CalendarEventInput,
  ): Promise<{ eventId: string }> {
    const body = {
      summary: input.title,
      description: input.description,
      start: { dateTime: input.start.toISOString() },
      end: { dateTime: input.end.toISOString() },
      // Brings back an event the owner deleted, since the customer still expects the visit.
      status: "confirmed",
      extendedProperties: { private: { [BOOKING_KEY]: input.bookingId } },
    };
    if (eventId) {
      const updated = await this.call(connection, `/${encodeURIComponent(eventId)}`, {
        method: "PATCH",
        body,
      });
      if (updated.ok) return { eventId };
      if (updated.status !== 404 && updated.status !== 410) throw await apiError(updated);
    }
    const created = await this.call(connection, "", { method: "POST", body });
    if (!created.ok) throw await apiError(created);
    return { eventId: ((await created.json()) as { id: string }).id };
  }

  async deleteEvent(connection: CalendarConnection, eventId: string) {
    const response = await this.call(connection, `/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
    });
    // Already gone is as good as deleted.
    if (!response.ok && response.status !== 404 && response.status !== 410)
      throw await apiError(response);
  }

  async changes(
    connection: CalendarConnection,
    syncToken: string | null,
    window: { from: Date; to: Date },
  ): Promise<CalendarChanges> {
    if (syncToken) {
      const changed = await this.collect(connection, { syncToken });
      // Google expired the token (410): read everything again.
      if (changed) return { ...changed, full: false };
    }
    const all = await this.collect(connection, {
      timeMin: window.from.toISOString(),
      timeMax: window.to.toISOString(),
    });
    return {
      events: (all?.events ?? []).filter((event) => !event.cancelled),
      nextSyncToken: all?.nextSyncToken ?? "",
      full: true,
    };
  }

  /** Every page of the event feed; null when the sync token has expired. */
  private async collect(connection: CalendarConnection, query: Record<string, string>) {
    const events: ExternalEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken = "";
    do {
      const response = await this.call(connection, "", {
        query: {
          ...query,
          singleEvents: "true",
          showDeleted: "true",
          maxResults: "250",
          ...(pageToken && { pageToken }),
        },
      });
      if (response.status === 410 && query.syncToken) return null;
      if (!response.ok) throw await apiError(response);
      const page = (await response.json()) as {
        items?: GoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      };
      events.push(...(page.items ?? []).map(toExternal));
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    return { events, nextSyncToken };
  }

  /** One Calendar API request, with a fresh access token (and one retry if Google rejects it). */
  private async call(
    connection: CalendarConnection,
    path: string,
    options: { method?: string; body?: unknown; query?: Record<string, string> } = {},
  ): Promise<Response> {
    const url = new URL(`${EVENTS_URL}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {}))
      url.searchParams.set(key, value);
    const send = async () =>
      fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${await this.accessToken(connection)}`,
          ...(options.body !== undefined && { "Content-Type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(20_000),
      });
    const response = await send();
    if (response.status !== 401) return response;
    this.accessTokens.delete(refreshTokenOf(connection));
    return send();
  }

  private async accessToken(connection: CalendarConnection): Promise<string> {
    const refreshToken = refreshTokenOf(connection);
    const cached = this.accessTokens.get(refreshToken);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const token = await this.tokenRequest({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    return this.remember(refreshToken, token);
  }

  private remember(refreshToken: string, token: TokenResponse) {
    this.accessTokens.set(refreshToken, {
      value: token.access_token,
      expiresAt: Date.now() + (token.expires_in - 60) * 1000,
    });
    return token.access_token;
  }

  private async tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        ...params,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & {
      error?: string;
      error_description?: string;
    };
    // invalid_grant: the access was revoked, or Google's 7-day limit for testing apps ran out.
    if (data.error === "invalid_grant") throw new CalendarAuthExpired();
    if (!response.ok || !data.access_token)
      throw new Error(
        `Google sign-in failed (${response.status}): ${data.error_description ?? data.error ?? response.statusText}`,
      );
    return data as TokenResponse;
  }
}

function refreshTokenOf(connection: CalendarConnection) {
  try {
    const { refreshToken } = JSON.parse(connection.credentials ?? "{}") as Partial<Credentials>;
    if (refreshToken) return refreshToken;
  } catch {
    // Unreadable credentials: the owner connects again.
  }
  throw new CalendarAuthExpired();
}

/** The account's email, from the ID token Google returned over its own TLS connection. */
function emailOf(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
    };
    return claims.email ?? null;
  } catch {
    return null;
  }
}

function at(time: GoogleEvent["start"]): Date {
  if (time?.dateTime) return new Date(time.dateTime);
  // All-day events: the whole day is busy.
  if (time?.date) return new Date(`${time.date}T00:00:00Z`);
  return new Date(0);
}

/** A Google event as busy time. "Free" events and invitations the owner declined don't block. */
export function toExternal(event: GoogleEvent): ExternalEvent {
  const bookingId = event.extendedProperties?.private?.[BOOKING_KEY] ?? null;
  const declined = event.attendees?.some(
    (attendee) => attendee.self && attendee.responseStatus === "declined",
  );
  return {
    id: event.id,
    title: event.summary ?? null,
    start: at(event.start),
    end: at(event.end),
    bookingId,
    cancelled:
      event.status === "cancelled" ||
      (!bookingId && (event.transparency === "transparent" || Boolean(declined))),
  };
}

async function apiError(response: Response) {
  const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  return new Error(
    `Google Calendar refused (${response.status}): ${data.error?.message ?? response.statusText}`,
  );
}
