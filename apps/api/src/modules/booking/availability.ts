import { type BookingSettings, WEEKDAY_KEYS } from "@leadanchor/contracts";
import { localDate, shiftDate, weekdayOf, zonedTime } from "../../lib/zoned";

export interface Interval {
  start: Date;
  end: Date;
}

export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export interface AvailabilityInput {
  settings: BookingSettings;
  timezone: string;
  durationMins: number;
  /** Booked visits and the owner's calendar events. */
  busy: Interval[];
  now: Date;
  /** Just this local day (e.g. to check one slot), instead of the whole booking window. */
  day?: string;
}

/**
 * C-17 / C-18: the start times a job of this length can take. A slot fits inside the day's
 * opening hours, starts after the notice period, and keeps the buffer clear of every busy time
 * on both sides (the drive to the next job, or from the last one).
 */
export function availableSlots(input: AvailabilityInput): Array<{ date: string; slots: Date[] }> {
  const { settings, timezone } = input;
  const duration = input.durationMins * 60_000;
  const buffer = settings.bufferMins * 60_000;
  const step = settings.stepMins * 60_000;
  const earliest = input.now.getTime() + settings.noticeHours * 3_600_000;
  const today = localDate(input.now, timezone);
  const lastDay = shiftDate(today, settings.windowDays - 1);
  const days = input.day
    ? [input.day]
    : Array.from({ length: settings.windowDays }, (_, index) => shiftDate(today, index));

  return days.map((date) => {
    const hours = settings.hours[WEEKDAY_KEYS[weekdayOf(date)]!];
    if (date < today || date > lastDay || !hours.open) return { date, slots: [] };
    const open = zonedTime(date, hours.start, timezone).getTime();
    const close = zonedTime(date, hours.end, timezone).getTime();
    const slots: Date[] = [];
    for (let start = open; start + duration <= close; start += step) {
      if (start < earliest) continue;
      const needed = { start: new Date(start - buffer), end: new Date(start + duration + buffer) };
      if (!input.busy.some((busy) => overlaps(needed, busy))) slots.push(new Date(start));
    }
    return { date, slots };
  });
}

/** Whether a customer may take exactly this start time. */
export function isBookable(input: Omit<AvailabilityInput, "day">, startsAt: Date) {
  const day = localDate(startsAt, input.timezone);
  return availableSlots({ ...input, day }).some((entry) =>
    entry.slots.some((slot) => slot.getTime() === startsAt.getTime()),
  );
}
