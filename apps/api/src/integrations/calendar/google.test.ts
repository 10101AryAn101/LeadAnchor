import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleCalendar, toExternal } from "./google";
import { CalendarAuthExpired, CalendarConnectRefused } from "./types";

const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const idToken = (email: string) =>
  `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;
const connection = { account: "owner@example.com", credentials: '{"refreshToken":"rt_1"}' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fake Google: answers token and Calendar requests, and remembers what was asked. */
function fakeGoogle(handle: (url: URL, init: RequestInit) => Response | undefined) {
  const calls: Array<{ url: URL; method: string; body: string | null }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      calls.push({ url, method: init.method ?? "GET", body: init.body ? String(init.body) : null });
      if (url.hostname === "oauth2.googleapis.com" && !handle(url, init))
        return json({ access_token: "at_1", expires_in: 3600 });
      return handle(url, init) ?? json({}, 404);
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Google sign-in", () => {
  const google = new GoogleCalendar("client-1", "secret-1");

  it("asks for calendar events and a refresh token, carrying the sealed state", () => {
    const url = new URL(google.authorizeUrl("sealed-state", "http://localhost:3000/cb"));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe(`openid email ${EVENTS_SCOPE}`);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("sealed-state");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/cb");
  });

  it("keeps the refresh token and names the calendar by the account's email", async () => {
    fakeGoogle((url) =>
      url.hostname === "oauth2.googleapis.com"
        ? json({
            access_token: "at_1",
            expires_in: 3600,
            refresh_token: "rt_1",
            scope: `openid ${EVENTS_SCOPE} email`,
            id_token: idToken("owner@example.com"),
          })
        : undefined,
    );
    const result = await google.finishConnect({ code: "code-1", redirectUri: "http://x/cb" });
    expect(result).toEqual({
      account: "owner@example.com",
      credentials: '{"refreshToken":"rt_1"}',
    });
  });

  it("refuses when the calendar box was unticked, or there's no ongoing access", async () => {
    fakeGoogle((url) =>
      url.hostname === "oauth2.googleapis.com"
        ? json({ access_token: "a", expires_in: 3600, refresh_token: "r", scope: "openid email" })
        : undefined,
    );
    await expect(google.finishConnect({ code: "c", redirectUri: "u" })).rejects.toEqual(
      new CalendarConnectRefused("no_access"),
    );
    fakeGoogle((url) =>
      url.hostname === "oauth2.googleapis.com"
        ? json({ access_token: "a", expires_in: 3600, scope: EVENTS_SCOPE })
        : undefined,
    );
    await expect(google.finishConnect({ code: "c", redirectUri: "u" })).rejects.toEqual(
      new CalendarConnectRefused("no_offline"),
    );
  });

  it("says the connection has ended when Google refuses the refresh token", async () => {
    fakeGoogle((url) =>
      url.hostname === "oauth2.googleapis.com"
        ? json({ error: "invalid_grant", error_description: "Token has been expired" }, 400)
        : undefined,
    );
    await expect(
      new GoogleCalendar("c", "s").changes(connection, null, { from: new Date(), to: new Date() }),
    ).rejects.toBeInstanceOf(CalendarAuthExpired);
  });
});

describe("Google Calendar sync", () => {
  const window = { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-12-01T00:00:00Z") };
  const busy = {
    id: "e1",
    summary: "Dentist",
    start: { dateTime: "2026-11-03T15:00:00Z" },
    end: { dateTime: "2026-11-03T16:00:00Z" },
  };

  it("reads every page of a full sync, keeping only live events, and returns the sync token", async () => {
    const calls = fakeGoogle((url) => {
      if (url.hostname !== "www.googleapis.com") return undefined;
      return url.searchParams.get("pageToken")
        ? json({ items: [{ id: "e2", status: "cancelled" }], nextSyncToken: "sync-1" })
        : json({ items: [busy], nextPageToken: "page-2" });
    });
    const changes = await new GoogleCalendar("c", "s").changes(connection, null, window);
    expect(changes.full).toBe(true);
    expect(changes.nextSyncToken).toBe("sync-1");
    expect(changes.events.map((event) => event.id)).toEqual(["e1"]);
    const first = calls.find((call) => call.url.hostname === "www.googleapis.com")!;
    expect(first.url.searchParams.get("timeMin")).toBe(window.from.toISOString());
    expect(first.url.searchParams.get("singleEvents")).toBe("true");
  });

  it("starts over with a full sync when Google has expired the sync token", async () => {
    fakeGoogle((url) => {
      if (url.hostname !== "www.googleapis.com") return undefined;
      return url.searchParams.get("syncToken")
        ? json({ error: { message: "Sync token is no longer valid" } }, 410)
        : json({ items: [busy], nextSyncToken: "sync-2" });
    });
    const changes = await new GoogleCalendar("c", "s").changes(connection, "old-token", window);
    expect(changes).toMatchObject({ full: true, nextSyncToken: "sync-2" });
  });

  it("re-creates a booking's event the owner deleted", async () => {
    const calls = fakeGoogle((url, init) => {
      if (url.hostname !== "www.googleapis.com") return undefined;
      if (init.method === "PATCH") return json({ error: { message: "Not Found" } }, 404);
      if (init.method === "POST") return json({ id: "new-event" });
      return undefined;
    });
    const result = await new GoogleCalendar("c", "s").upsertEvent(connection, "gone", {
      bookingId: "b1",
      title: "Drain cleaning: Maria",
      description: "Booked in LeadAnchor.",
      start: new Date("2026-11-05T15:00:00Z"),
      end: new Date("2026-11-05T16:00:00Z"),
    });
    expect(result).toEqual({ eventId: "new-event" });
    const created = calls.find(
      (call) => call.method === "POST" && call.url.hostname === "www.googleapis.com",
    )!;
    expect(JSON.parse(created.body!).extendedProperties.private.leadanchorBookingId).toBe("b1");
  });

  it("doesn't count free time or declined invitations as busy, but keeps our own bookings", () => {
    expect(toExternal({ ...busy, transparency: "transparent" }).cancelled).toBe(true);
    expect(
      toExternal({ ...busy, attendees: [{ self: true, responseStatus: "declined" }] }).cancelled,
    ).toBe(true);
    const ours = toExternal({
      ...busy,
      transparency: "transparent",
      extendedProperties: { private: { leadanchorBookingId: "b1" } },
    });
    expect(ours).toMatchObject({ bookingId: "b1", cancelled: false });
    expect(
      toExternal({ id: "d", start: { date: "2026-11-10" }, end: { date: "2026-11-11" } }).start,
    ).toEqual(new Date("2026-11-10T00:00:00Z"));
  });
});
