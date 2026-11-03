/** The time zones a US business can pick, as the IANA names clocks and calendars use. */
export const US_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;
export type UsTimeZone = (typeof US_TIME_ZONES)[number];

export const US_TIME_ZONE_LABELS: Record<UsTimeZone, string> = {
  "America/New_York": "Eastern Time",
  "America/Chicago": "Central Time",
  "America/Denver": "Mountain Time",
  "America/Phoenix": "Arizona Time (no daylight saving)",
  "America/Los_Angeles": "Pacific Time",
  "America/Anchorage": "Alaska Time",
  "Pacific/Honolulu": "Hawaii Time",
};

const EASTERN = "America/New_York";
const CENTRAL = "America/Chicago";
const MOUNTAIN = "America/Denver";
const ARIZONA = "America/Phoenix";
const PACIFIC = "America/Los_Angeles";

/** Each state's zones, the one most of its people use first (most of Texas is Central, El Paso Mountain). */
const STATE_TIME_ZONES: Record<string, readonly UsTimeZone[]> = {
  AL: [CENTRAL],
  AK: ["America/Anchorage"],
  AZ: [ARIZONA, MOUNTAIN],
  AR: [CENTRAL],
  CA: [PACIFIC],
  CO: [MOUNTAIN],
  CT: [EASTERN],
  DC: [EASTERN],
  DE: [EASTERN],
  FL: [EASTERN, CENTRAL],
  GA: [EASTERN],
  HI: ["Pacific/Honolulu"],
  IA: [CENTRAL],
  ID: [MOUNTAIN, PACIFIC],
  IL: [CENTRAL],
  IN: [EASTERN, CENTRAL],
  KS: [CENTRAL, MOUNTAIN],
  KY: [EASTERN, CENTRAL],
  LA: [CENTRAL],
  MA: [EASTERN],
  MD: [EASTERN],
  ME: [EASTERN],
  MI: [EASTERN, CENTRAL],
  MN: [CENTRAL],
  MO: [CENTRAL],
  MS: [CENTRAL],
  MT: [MOUNTAIN],
  NC: [EASTERN],
  ND: [CENTRAL, MOUNTAIN],
  NE: [CENTRAL, MOUNTAIN],
  NH: [EASTERN],
  NJ: [EASTERN],
  NM: [MOUNTAIN],
  NV: [PACIFIC, MOUNTAIN],
  NY: [EASTERN],
  OH: [EASTERN],
  OK: [CENTRAL],
  OR: [PACIFIC, MOUNTAIN],
  PA: [EASTERN],
  RI: [EASTERN],
  SC: [EASTERN],
  SD: [CENTRAL, MOUNTAIN],
  TN: [CENTRAL, EASTERN],
  TX: [CENTRAL, MOUNTAIN],
  UT: [MOUNTAIN],
  VA: [EASTERN],
  VT: [EASTERN],
  WA: [PACIFIC],
  WI: [CENTRAL],
  WV: [EASTERN],
  WY: [MOUNTAIN],
};

/** True when the clock rules know `zone` (an IANA name such as "America/Chicago"). */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const isUsTimeZone = (zone: string): zone is UsTimeZone =>
  (US_TIME_ZONES as readonly string[]).includes(zone);

/** Minutes ahead of UTC that clocks in `zone` show at `at`. */
function offsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return (
    (Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")) -
      at.getTime()) /
    60_000
  );
}

const WINTER = new Date(Date.UTC(2026, 0, 15, 12));
const SUMMER = new Date(Date.UTC(2026, 6, 15, 12));

/** The US zone whose clock matches `zone` all year (Detroit keeps Eastern Time, Boise Mountain), or null. */
export function usTimeZoneLike(zone: string): UsTimeZone | null {
  if (!isTimeZone(zone)) return null;
  const winter = offsetMinutes(zone, WINTER);
  const summer = offsetMinutes(zone, SUMMER);
  return (
    US_TIME_ZONES.find(
      (us) => offsetMinutes(us, WINTER) === winter && offsetMinutes(us, SUMMER) === summer,
    ) ?? null
  );
}

/**
 * The time zone to suggest for a business: its state's, or the browser's own when the state spans
 * two zones and the browser is in one of them. With no state, the browser's if it keeps US time,
 * else Central. Someone setting up from abroad still gets their business's clock, not their own.
 */
export function suggestTimeZone(
  state: string | null | undefined,
  browserZone?: string | null,
): UsTimeZone {
  const browser = browserZone ? usTimeZoneLike(browserZone) : null;
  const zones = STATE_TIME_ZONES[(state ?? "").trim().toUpperCase()];
  if (zones) return browser && zones.includes(browser) ? browser : zones[0]!;
  return browser ?? CENTRAL;
}
