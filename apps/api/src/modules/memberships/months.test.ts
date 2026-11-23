import { describe, expect, it } from "vitest";
import { monthOf, monthsEnding, previousMonth } from "./months";

describe("income months (C-50)", () => {
  it("names the month in the business's own time zone", () => {
    // 2 am UTC on Dec 1 is still November in Chicago.
    expect(monthOf(new Date("2026-12-01T02:00:00Z"), "America/Chicago")).toBe("2026-11");
    expect(monthOf(new Date("2026-12-01T02:00:00Z"), "UTC")).toBe("2026-12");
  });

  it("steps back across the new year", () => {
    expect(previousMonth("2026-11")).toBe("2026-10");
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(monthsEnding("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});
