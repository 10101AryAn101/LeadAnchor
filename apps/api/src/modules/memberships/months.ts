import { localDate } from "../../lib/zoned";

/** "2026-11": a month in the business's own time zone. */
export const monthOf = (at: Date, timeZone: string) => localDate(at, timeZone).slice(0, 7);

/** The month before "2026-01" is "2025-12". */
export function previousMonth(month: string) {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, "0")}`;
}

/** The last `count` months, oldest first, ending with `month`. */
export function monthsEnding(month: string, count: number) {
  const months = [month];
  while (months.length < count) months.unshift(previousMonth(months[0]!));
  return months;
}
