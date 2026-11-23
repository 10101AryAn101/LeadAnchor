import { defaultBookingSettings } from "@leadanchor/contracts";
import { describe, expect, it } from "vitest";
import { friendlyTime, localDate, shiftDate, zonedTime } from "../../lib/zoned";
import { availableSlots, isBookable } from "./availability";

const TZ = "America/Chicago";
const settings = { ...defaultBookingSettings("B"), enabled: true };
// Mon 2 Nov 2026, 7:00 AM in Chicago (CST, UTC-6: daylight saving ended the day before).
const mondaySeven = new Date("2026-11-02T13:00:00Z");
const times = (slots: Date[]) =>
  slots.map((slot) =>
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(
      slot,
    ),
  );

describe("business-local time", () => {
  it("turns a local wall time into the right instant, either side of the DST change", () => {
    expect(zonedTime("2026-10-30", "09:00", TZ).toISOString()).toBe("2026-10-30T14:00:00.000Z"); // CDT
    expect(zonedTime("2026-11-02", "09:00", TZ).toISOString()).toBe("2026-11-02T15:00:00.000Z"); // CST
    expect(localDate(new Date("2026-11-03T03:00:00Z"), TZ)).toBe("2026-11-02");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(friendlyTime(new Date("2026-11-02T15:00:00Z"), TZ)).toBe("Mon, Nov 2 at 9:00 AM");
  });
});

describe("availability (C-17, C-18)", () => {
  it("offers the day's hours after the notice period, every 30 minutes", () => {
    const [monday] = availableSlots({
      settings,
      timezone: TZ,
      durationMins: 60,
      busy: [],
      now: mondaySeven,
    });
    expect(monday!.date).toBe("2026-11-02");
    // Open 8 to 5, 2 hours' notice from 7 AM: 9 AM first; a 1-hour job last starts at 4 PM.
    expect(times(monday!.slots).at(0)).toBe("9:00 AM");
    expect(times(monday!.slots).at(-1)).toBe("4:00 PM");
  });

  it("uses each service's own length", () => {
    const [monday] = availableSlots({
      settings,
      timezone: TZ,
      durationMins: 90,
      busy: [],
      now: mondaySeven,
    });
    expect(times(monday!.slots).at(-1)).toBe("3:30 PM");
  });

  it("skips closed days and stops at the booking window", () => {
    const days = availableSlots({
      settings,
      timezone: TZ,
      durationMins: 60,
      busy: [],
      now: mondaySeven,
    });
    expect(days).toHaveLength(14);
    expect(days.find((d) => d.date === "2026-11-07")!.slots).toEqual([]); // Saturday
    expect(days.find((d) => d.date === "2026-11-08")!.slots).toEqual([]); // Sunday
  });

  it("never offers a time that overlaps a booking or a calendar event", () => {
    const busy = [
      { start: zonedTime("2026-11-02", "10:00", TZ), end: zonedTime("2026-11-02", "11:00", TZ) },
    ];
    const [monday] = availableSlots({
      settings,
      timezone: TZ,
      durationMins: 60,
      busy,
      now: mondaySeven,
    });
    expect(times(monday!.slots).slice(0, 3)).toEqual(["9:00 AM", "11:00 AM", "11:30 AM"]);
  });

  it("keeps the buffer free on both sides of a job", () => {
    const busy = [
      { start: zonedTime("2026-11-02", "11:00", TZ), end: zonedTime("2026-11-02", "12:00", TZ) },
    ];
    const [monday] = availableSlots({
      settings: { ...settings, bufferMins: 30 },
      timezone: TZ,
      durationMins: 60,
      busy,
      now: mondaySeven,
    });
    // A job must end 30 minutes before 11 and can start 30 minutes after 12.
    expect(times(monday!.slots)).toEqual(expect.arrayContaining(["9:30 AM", "12:30 PM"]));
    expect(times(monday!.slots)).not.toContain("10:00 AM");
    expect(times(monday!.slots)).not.toContain("12:00 PM");
  });

  it("only accepts start times the page would offer", () => {
    const input = { settings, timezone: TZ, durationMins: 60, busy: [], now: mondaySeven };
    expect(isBookable(input, zonedTime("2026-11-03", "10:00", TZ))).toBe(true);
    expect(isBookable(input, zonedTime("2026-11-03", "10:10", TZ))).toBe(false); // not on the 30-minute grid
    expect(isBookable(input, zonedTime("2026-11-02", "08:00", TZ))).toBe(false); // inside the notice period
    expect(isBookable(input, zonedTime("2026-11-07", "10:00", TZ))).toBe(false); // closed Saturday
  });
});
