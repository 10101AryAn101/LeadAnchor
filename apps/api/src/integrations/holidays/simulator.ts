import type { Holiday, HolidayKey, HolidayProvider } from "./types";

const pad = (value: number) => String(value).padStart(2, "0");
const ymd = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

/** The `nth` given weekday (0 = Sunday) of a month; a negative `nth` counts from the end. */
function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  if (nth > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return ymd(year, month, 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return ymd(year, month, lastDay - ((last - weekday + 7) % 7) + (nth + 1) * 7);
}

/** The US holidays and observances that move customers, for one year. */
export function usHolidays(year: number): Holiday[] {
  const list: Array<[HolidayKey, string, string]> = [
    ["new_year", "New Year's Day", ymd(year, 1, 1)],
    ["valentines", "Valentine's Day", ymd(year, 2, 14)],
    ["mothers_day", "Mother's Day", nthWeekday(year, 5, 0, 2)],
    ["memorial_day", "Memorial Day", nthWeekday(year, 5, 1, -1)],
    ["fathers_day", "Father's Day", nthWeekday(year, 6, 0, 3)],
    ["independence_day", "the Fourth of July", ymd(year, 7, 4)],
    ["labor_day", "Labor Day", nthWeekday(year, 9, 1, 1)],
    ["thanksgiving", "Thanksgiving", nthWeekday(year, 11, 4, 4)],
    ["christmas", "Christmas", ymd(year, 12, 25)],
  ];
  return list.map(([key, name, date]) => ({ key, name, date }));
}

/** Stand-in for a holiday API: the dates are fixed rules, so they're worked out here. */
export class SimulatorHolidays implements HolidayProvider {
  readonly name = "simulator" as const;

  async between(from: string, to: string): Promise<Holiday[]> {
    const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))]);
    return [...years]
      .flatMap(usHolidays)
      .filter((holiday) => holiday.date >= from && holiday.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
