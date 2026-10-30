import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DayForecast, WeatherProvider } from "./types";

export type WeatherScenario = "freeze" | "heat" | "mild";

type Store = Record<string, { scenario: WeatherScenario; setAt: string }>;

/** A typical low and high (°F) for each month in the southern US, where most demo businesses sit. */
const NORMALS: Array<[number, number]> = [
  [40, 61],
  [44, 65],
  [51, 72],
  [58, 79],
  [66, 86],
  [72, 92],
  [74, 96],
  [74, 97],
  [69, 91],
  [60, 82],
  [50, 71],
  [42, 63],
];

const DAY_MS = 86_400_000;

/**
 * Stand-in for a weather service while none is set up: an ordinary week for the time of year,
 * unless a cold snap or heat wave has been switched on (from Dev tools). Either one lands three
 * and four days out, early enough for the owner to act on it.
 */
export class SimulatorWeather implements WeatherProvider {
  readonly name = "simulator" as const;
  private cache: Store | null = null;

  constructor(private readonly file: string) {}

  async forecast(tenantId: string): Promise<DayForecast[]> {
    const scenario = this.read()[tenantId]?.scenario ?? "mild";
    const today = Date.now();
    return Array.from({ length: 7 }, (_, offset) => {
      const day = new Date(today + offset * DAY_MS);
      const [low, high] = NORMALS[day.getUTCMonth()]!;
      // A gentle wobble so the week doesn't look copied.
      const wobble = ((day.getUTCDate() * 5) % 7) - 3;
      let lowF = low + wobble;
      let highF = high + wobble;
      if (scenario === "freeze" && (offset === 3 || offset === 4)) {
        lowF = offset === 3 ? 26 : 29;
        highF = offset === 3 ? 41 : 45;
      }
      if (scenario === "heat" && (offset === 3 || offset === 4)) {
        lowF = 79;
        highF = offset === 3 ? 104 : 102;
      }
      return { date: day.toISOString().slice(0, 10), lowF, highF };
    });
  }

  scenarioOf(tenantId: string): WeatherScenario {
    return this.read()[tenantId]?.scenario ?? "mild";
  }

  setScenario(tenantId: string, scenario: WeatherScenario) {
    this.write((store) => {
      store[tenantId] = { scenario, setAt: new Date().toISOString() };
    });
  }

  private read(): Store {
    if (this.cache) return this.cache;
    this.cache = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, "utf8")) as Store)
      : {};
    return this.cache;
  }

  private write(change: (store: Store) => unknown) {
    const store = this.read();
    change(store);
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(store, null, 2));
    renameSync(temp, this.file);
  }
}
