/** One day's forecast for the business's town (C-30). */
export interface DayForecast {
  /** "2026-11-03" */
  date: string;
  lowF: number;
  highF: number;
}

export interface Place {
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

/**
 * Weather port (C-30: "a freeze is coming, offer pipe protection"). The US National Weather
 * Service API (free, no key) joins in step 2; until then the simulator forecasts, and can be
 * told a cold snap or a heat wave is coming.
 */
export interface WeatherProvider {
  readonly name: "simulator" | "nws";
  /** The next week, starting today. `tenantId` lets the simulator keep each business's scenario. */
  forecast(tenantId: string, place: Place): Promise<DayForecast[]>;
}
