import {
  cadenceLabel,
  membershipConsentText,
  membershipTerms,
  monthlyCents,
  planPrice,
  workDue,
} from "@leadanchor/contracts";
import { describe, expect, it } from "vitest";

describe("membership rules (module 12)", () => {
  it("counts a yearly plan as a twelfth a month in recurring income", () => {
    expect(monthlyCents(9_900, "month")).toBe(9_900);
    expect(monthlyCents(99_000, "year")).toBe(8_250);
    expect(planPrice(9_900, "month")).toBe("$99 a month");
    expect(planPrice(12_450, "year")).toBe("$124.50 a year");
  });

  it("puts the plan's job on the board on its cadence (C-51)", () => {
    const every = { kind: "every" as const, every: 2, months: [] };
    const third = { kind: "nth" as const, every: 3, months: [] };
    const spring = { kind: "months" as const, every: 2, months: [3, 9] };
    expect([1, 2, 3].map((bill) => workDue(every, bill, 5))).toEqual([true, true, true]);
    expect([1, 2, 3, 4, 5, 6, 7].map((bill) => workDue(third, bill, 5))).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
    expect([workDue(spring, 4, 3), workDue(spring, 5, 4), workDue(spring, 10, 9)]).toEqual([
      true,
      false,
      true,
    ]);
    expect(workDue({ kind: "none", every: 2, months: [] }, 1, 1)).toBe(false);
    expect([
      cadenceLabel(third),
      cadenceLabel({ ...third, every: 2 }),
      cadenceLabel(spring),
    ]).toEqual(["Every 3rd bill", "Every 2nd bill", "Bills in Mar, Sep"]);
  });

  it("says the price, how often, until cancelled, and how to cancel, before they pay (ROSCA)", () => {
    const terms = membershipTerms({
      business: "Demo Plumbing",
      priceCents: 9_900,
      interval: "month",
    }).join(" ");
    expect(terms).toContain("$99 today, then $99 every month until you cancel");
    expect(terms).toContain("Cancel any time from the link in every receipt");
    expect(terms).toContain("no phone call");
    expect(
      membershipConsentText({ business: "Demo Plumbing", priceCents: 99_000, interval: "year" }),
    ).toBe(
      "I agree that Demo Plumbing will charge my card $990 today and then every year until I cancel.",
    );
  });
});
