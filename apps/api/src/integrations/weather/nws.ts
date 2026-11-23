import { logger } from "../../lib/logger";
import type { DayForecast, Place, WeatherProvider } from "./types";

const NWS = "https://api.weather.gov";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const TIMEOUT_MS = 10_000;
/** A forecast is re-read at most this often; the offer check runs every six hours anyway. */
const FORECAST_TTL_MS = 60 * 60_000;
/** Nominatim's usage policy: at most one request a second, from one identified app. */
const GEOCODE_GAP_MS = 1_100;

interface Point {
  lat: number;
  lon: number;
}

interface Period {
  startTime: string;
  isDaytime: boolean;
  temperature: number | null;
  temperatureUnit: string;
}

/**
 * The US National Weather Service (api.weather.gov): free, no key, US only (C-30). It forecasts
 * for a point, so the business's town is first turned into coordinates with OpenStreetMap's
 * free geocoder. Both ask for a User-Agent that names the app and a contact.
 *
 * A failure never stops the offer check: the business simply gets no weather idea this round,
 * and the next six-hourly check tries again. Places outside the US have no forecast.
 */
export class NationalWeatherService implements WeatherProvider {
  readonly name = "nws" as const;
  private readonly points = new Map<string, Point | null>();
  private readonly forecastUrls = new Map<string, string>();
  private readonly forecasts = new Map<string, { at: number; days: DayForecast[] }>();
  private lastGeocodeAt = 0;

  constructor(private readonly userAgent: string) {}

  async forecast(_tenantId: string, place: Place): Promise<DayForecast[]> {
    const query = placeQuery(place);
    if (!query) return [];
    try {
      const point = await this.locate(query);
      if (!point) return [];
      const url = await this.forecastUrl(point);
      const cached = this.forecasts.get(url);
      if (cached && Date.now() - cached.at < FORECAST_TTL_MS) return cached.days;
      const body = (await this.get(url)) as { properties?: { periods?: Period[] } };
      const days = dailyHighsAndLows(body.properties?.periods ?? []);
      this.forecasts.set(url, { at: Date.now(), days });
      return days;
    } catch (error) {
      logger.warn({ err: error, place: query.label }, "weather forecast unavailable");
      return [];
    }
  }

  /** Town → coordinates, remembered (a town doesn't move). Null when it isn't a US place. */
  private async locate(query: PlaceQuery): Promise<Point | null> {
    if (this.points.has(query.label)) return this.points.get(query.label)!;
    const wait = this.lastGeocodeAt + GEOCODE_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastGeocodeAt = Date.now();

    const url = new URL(NOMINATIM);
    for (const [key, value] of Object.entries(query.params)) url.searchParams.set(key, value);
    url.searchParams.set("countrycodes", "us");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    const [hit] = (await this.get(url.toString())) as Array<{ lat: string; lon: string }>;
    // weather.gov takes at most four decimal places.
    const point = hit ? { lat: round4(Number(hit.lat)), lon: round4(Number(hit.lon)) } : null;
    this.points.set(query.label, point);
    return point;
  }

  /** Coordinates → the forecast office's grid; weather.gov says which URL to read. */
  private async forecastUrl(point: Point): Promise<string> {
    const key = `${point.lat},${point.lon}`;
    const known = this.forecastUrls.get(key);
    if (known) return known;
    const body = (await this.get(`${NWS}/points/${key}`)) as { properties?: { forecast?: string } };
    const url = body.properties?.forecast;
    if (!url) throw new Error(`weather.gov has no forecast for ${key}`);
    this.forecastUrls.set(key, url);
    return url;
  }

  private async get(url: string, retried = false): Promise<unknown> {
    const response = await fetch(url, {
      headers: { "User-Agent": this.userAgent, Accept: "application/geo+json, application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // weather.gov answers the odd request with a 500 that works on the second try.
    if (response.status >= 500 && !retried) return this.get(url, true);
    if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`);
    return response.json();
  }
}

interface PlaceQuery {
  label: string;
  params: Record<string, string>;
}

/** The ZIP code is the surest; otherwise city and state. Nothing to go on, no forecast. */
function placeQuery(place: Place): PlaceQuery | null {
  const postalCode = place.postalCode?.trim().slice(0, 5);
  if (postalCode && /^\d{5}$/.test(postalCode)) return { label: postalCode, params: { postalcode: postalCode } };
  const city = place.city?.trim();
  const state = place.state?.trim();
  if (!city || !state) return null;
  return { label: `${city}, ${state}`.toLowerCase(), params: { city, state } };
}

/**
 * weather.gov gives twelve-hour periods: daytime ones carry the high, overnight ones the low. A
 * night is counted on the day it starts, so "Tuesday night, low 26°F" is a freeze on Tuesday,
 * early enough to wrap pipes. A day with only one of the two (today's night, the last day) uses
 * that one reading for both.
 */
export function dailyHighsAndLows(periods: Period[]): DayForecast[] {
  const days = new Map<string, { high?: number; low?: number }>();
  for (const period of periods) {
    if (period.temperature == null) continue;
    const f =
      period.temperatureUnit === "C" ? Math.round((period.temperature * 9) / 5 + 32) : period.temperature;
    // The local date at the place, as weather.gov writes it ("2026-11-03T18:00:00-06:00").
    const date = period.startTime.slice(0, 10);
    const day = days.get(date) ?? {};
    if (period.isDaytime) day.high = Math.max(day.high ?? f, f);
    else day.low = Math.min(day.low ?? f, f);
    days.set(date, day);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { high, low }]) => ({ date, lowF: low ?? high!, highF: high ?? low! }));
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
