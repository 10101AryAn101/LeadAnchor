import { afterEach, describe, expect, it, vi } from "vitest";
import { NationalWeatherService, dailyHighsAndLows } from "./nws";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const period = (startTime: string, isDaytime: boolean, temperature: number, temperatureUnit = "F") => ({
  startTime,
  isDaytime,
  temperature,
  temperatureUnit,
});

const AUSTIN_PERIODS = [
  period("2026-11-03T18:00:00-06:00", false, 41),
  period("2026-11-04T06:00:00-06:00", true, 58),
  period("2026-11-04T18:00:00-06:00", false, 27),
  period("2026-11-05T06:00:00-06:00", true, 44),
];

/** A fake weather.gov and OpenStreetMap: answers each request and remembers what was asked. */
function fakeWeb(handle: (url: URL) => Response | undefined) {
  const calls: Array<{ url: URL; userAgent: string | null }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      calls.push({ url, userAgent: new Headers(init.headers).get("User-Agent") });
      return handle(url) ?? json({}, 404);
    }),
  );
  return calls;
}

const austin = (url: URL) => {
  if (url.hostname === "nominatim.openstreetmap.org") return json([{ lat: "30.267153", lon: "-97.743057" }]);
  if (url.pathname === "/points/30.2672,-97.7431")
    return json({ properties: { forecast: "https://api.weather.gov/gridpoints/EWX/156,91/forecast" } });
  if (url.pathname === "/gridpoints/EWX/156,91/forecast") return json({ properties: { periods: AUSTIN_PERIODS } });
  return undefined;
};

afterEach(() => vi.unstubAllGlobals());

describe("daily highs and lows from weather.gov's twelve-hour periods", () => {
  it("counts a night on the day it starts, and fills a half day with its one reading", () => {
    expect(dailyHighsAndLows(AUSTIN_PERIODS)).toEqual([
      { date: "2026-11-03", lowF: 41, highF: 41 },
      { date: "2026-11-04", lowF: 27, highF: 58 },
      { date: "2026-11-05", lowF: 44, highF: 44 },
    ]);
  });

  it("converts Celsius and skips periods without a temperature", () => {
    expect(
      dailyHighsAndLows([
        period("2026-07-01T06:00:00-05:00", true, 40, "C"),
        { ...period("2026-07-01T18:00:00-05:00", false, 0), temperature: null },
      ]),
    ).toEqual([{ date: "2026-07-01", lowF: 104, highF: 104 }]);
  });
});

describe("National Weather Service", () => {
  it("finds the town, asks weather.gov for its forecast, and names the app", async () => {
    const calls = fakeWeb(austin);
    const nws = new NationalWeatherService("LeadAnchor (owner@example.com)");
    const days = await nws.forecast("t1", { city: "Austin", state: "TX", postalCode: null });

    expect(days.find((day) => day.date === "2026-11-04")).toEqual({ date: "2026-11-04", lowF: 27, highF: 58 });
    const geocode = calls[0]!.url;
    expect(geocode.searchParams.get("city")).toBe("Austin");
    expect(geocode.searchParams.get("state")).toBe("TX");
    expect(geocode.searchParams.get("countrycodes")).toBe("us");
    expect(calls.every((call) => call.userAgent === "LeadAnchor (owner@example.com)")).toBe(true);
  });

  it("prefers the ZIP code, and remembers the town and its forecast", async () => {
    const calls = fakeWeb(austin);
    const nws = new NationalWeatherService("LeadAnchor (test)");
    const place = { city: "Austin", state: "TX", postalCode: "78704-1234" };
    await nws.forecast("t1", place);
    await nws.forecast("t2", place);

    expect(calls[0]!.url.searchParams.get("postalcode")).toBe("78704");
    expect(calls[0]!.url.searchParams.get("city")).toBeNull();
    expect(calls).toHaveLength(3);
  });

  it("tries a failed weather.gov request once more", async () => {
    let forecastAsks = 0;
    fakeWeb((url) => {
      if (url.pathname.endsWith("/forecast") && ++forecastAsks === 1) return json({}, 500);
      return austin(url);
    });
    const days = await new NationalWeatherService("LeadAnchor (test)").forecast("t1", {
      city: "Austin",
      state: "TX",
      postalCode: null,
    });
    expect(forecastAsks).toBe(2);
    expect(days).toHaveLength(3);
  });

  it("gives no forecast, without failing, for a place outside the US or a service that's down", async () => {
    fakeWeb((url) => (url.hostname === "nominatim.openstreetmap.org" ? json([]) : undefined));
    const nws = new NationalWeatherService("LeadAnchor (test)");
    await expect(nws.forecast("t1", { city: "Patna", state: "BR", postalCode: null })).resolves.toEqual([]);

    fakeWeb((url) => (url.hostname === "nominatim.openstreetmap.org" ? austin(url) : json({}, 503)));
    await expect(
      new NationalWeatherService("LeadAnchor (test)").forecast("t1", { city: "Austin", state: "TX", postalCode: null }),
    ).resolves.toEqual([]);
  });

  it("asks nothing when the business has no town", async () => {
    const calls = fakeWeb(() => undefined);
    const nws = new NationalWeatherService("LeadAnchor (test)");
    expect(await nws.forecast("t1", { city: null, state: "TX", postalCode: null })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
