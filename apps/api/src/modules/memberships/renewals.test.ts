import { describe, expect, it } from "vitest";
import { firstRenewalOnOrAfter } from "./renewals";

const at = (iso: string) => new Date(`${iso}T15:00:00Z`);

describe("when an announced price move starts (C-48 AC 2)", () => {
  it("is the first renewal at least the notice period away", () => {
    // Renews Nov 20; told Nov 5, so not before Dec 5: the Dec 20 renewal.
    expect(firstRenewalOnOrAfter(at("2026-11-20"), "month", at("2026-12-05"))).toEqual(
      at("2026-12-20"),
    );
    // Renews Dec 10, already past the notice: that renewal.
    expect(firstRenewalOnOrAfter(at("2026-12-10"), "month", at("2026-12-05"))).toEqual(
      at("2026-12-10"),
    );
    expect(firstRenewalOnOrAfter(at("2026-11-20"), "year", at("2026-12-05"))).toEqual(
      at("2027-11-20"),
    );
  });

  it("falls back to the end of the notice when there's no renewal date", () => {
    expect(firstRenewalOnOrAfter(null, "month", at("2026-12-05"))).toEqual(at("2026-12-05"));
  });
});
