export const HOLIDAY_KEYS = [
  "new_year",
  "valentines",
  "mothers_day",
  "memorial_day",
  "fathers_day",
  "independence_day",
  "labor_day",
  "thanksgiving",
  "christmas",
] as const;
export type HolidayKey = (typeof HOLIDAY_KEYS)[number];

export interface Holiday {
  key: HolidayKey;
  name: string;
  /** "2026-11-26" */
  date: string;
}

/**
 * Holiday port (C-30: seasonal offers before the holidays). A holiday calendar API (Nager.Date,
 * free, no key) joins in step 2; until then a built-in US calendar stands in.
 */
export interface HolidayProvider {
  readonly name: "simulator" | "nager";
  /** Holidays from `from` to `to` inclusive ("YYYY-MM-DD"). */
  between(from: string, to: string): Promise<Holiday[]>;
}
