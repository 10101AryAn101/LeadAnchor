import { describe, expect, it } from "vitest";
import { reminderDue } from "./reminders";

const HOUR = 3_600_000;
const visit = new Date("2026-11-10T17:00:00Z");
const bookedAhead = (hours: number) => ({
  startsAt: visit,
  createdAt: new Date(visit.getTime() - hours * HOUR),
});
const hoursBefore = (hours: number) => new Date(visit.getTime() - hours * HOUR);

describe("booking reminders (C-20)", () => {
  it("reminds a visit booked days ahead in the day before it", () => {
    expect(reminderDue(bookedAhead(72), hoursBefore(23))).toBe(true);
    expect(reminderDue(bookedAhead(72), hoursBefore(30))).toBe(false);
    expect(reminderDue(bookedAhead(72), hoursBefore(0.5))).toBe(false);
  });

  it("reminds a short-notice booking about 2 hours before", () => {
    expect(reminderDue(bookedAhead(8), hoursBefore(2))).toBe(true);
    expect(reminderDue(bookedAhead(8), hoursBefore(1))).toBe(true);
    expect(reminderDue(bookedAhead(8), hoursBefore(5))).toBe(false);
    expect(reminderDue(bookedAhead(8), hoursBefore(0.25))).toBe(false);
  });

  it("lets the confirmation do for a visit booked under 3 hours ahead", () => {
    expect(reminderDue(bookedAhead(2), hoursBefore(1))).toBe(false);
  });
});
