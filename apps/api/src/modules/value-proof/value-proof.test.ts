import { describe, expect, it } from "vitest";
import { localParts, summaryDue, summaryText } from "./value-proof";

const TZ = "America/Chicago";
// Mon 2 Nov 2026, 9:00 AM in Chicago (CST, UTC-6 — daylight saving ended the day before).
const mondayNine = new Date("2026-11-02T15:00:00Z");

describe("value-proof summary timing", () => {
  it("reads the business's own day, weekday and hour", () => {
    expect(localParts(mondayNine, TZ)).toEqual({ day: "2026-11-02", weekday: 1, hour: 9 });
  });

  it("never sends before 8 AM local time, or when switched off", () => {
    const sevenAm = new Date("2026-11-02T13:00:00Z");
    expect(summaryDue("daily", null, sevenAm, TZ)).toBe(false);
    expect(summaryDue("off", null, mondayNine, TZ)).toBe(false);
  });

  it("sends a daily summary once per day", () => {
    expect(summaryDue("daily", null, mondayNine, TZ)).toBe(true);
    expect(summaryDue("daily", new Date("2026-11-02T14:30:00Z"), mondayNine, TZ)).toBe(false);
    expect(summaryDue("daily", new Date("2026-11-01T15:00:00Z"), mondayNine, TZ)).toBe(true);
  });

  it("sends weekly on Monday, or catches up once a week has passed", () => {
    expect(summaryDue("weekly", null, mondayNine, TZ)).toBe(true);
    const tuesdayNine = new Date("2026-11-03T15:00:00Z");
    expect(summaryDue("weekly", new Date("2026-10-30T15:00:00Z"), tuesdayNine, TZ)).toBe(false);
    expect(summaryDue("weekly", new Date("2026-10-26T15:00:00Z"), tuesdayNine, TZ)).toBe(true);
  });
});

describe("value-proof summary wording", () => {
  it("states real numbers and never claims money without won jobs", () => {
    const { title, body } = summaryText("weekly", { caught: 23, dispatcher: 14, leads: 15, wonFromCalls: 0, recoveredCents: 0 });
    expect(title).toBe("Your week with LeadAnchor");
    expect(body).toContain("caught 23 missed calls (14 answered by the AI Dispatcher) and put 15 leads on your board");
    expect(body).not.toContain("$");
  });

  it("includes recovered money only from won jobs", () => {
    const { body } = summaryText("daily", { caught: 1, dispatcher: 0, leads: 1, wonFromCalls: 1, recoveredCents: 45_000 });
    expect(body).toContain("In the last 24 hours");
    expect(body).toContain("You won 1 job worth $450");
  });

  it("says plainly when nothing happened", () => {
    expect(summaryText("daily", { caught: 0, dispatcher: 0, leads: 0, wonFromCalls: 0, recoveredCents: 0 }).body).toContain("no missed calls to catch");
  });
});
