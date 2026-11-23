import { describe, expect, it } from "vitest";
import { idDeleteAfterOf } from "./id-retention";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("how long a registration keeps the full EIN and date of birth (C-43)", () => {
  it("deletes them 30 days after approval", () => {
    expect(
      idDeleteAfterOf({
        status: "approved",
        approvedAt: day("2026-11-01"),
        updatedAt: day("2026-11-01"),
      }),
    ).toEqual(day("2026-12-01"));
  });

  it("deletes them 30 days after a rejection, or after the owner stopped at the mobile check", () => {
    expect(
      idDeleteAfterOf({ status: "rejected", approvedAt: null, updatedAt: day("2026-11-05") }),
    ).toEqual(day("2026-12-05"));
    expect(
      idDeleteAfterOf({ status: "verify_mobile", approvedAt: null, updatedAt: day("2026-11-05") }),
    ).toEqual(day("2026-12-05"));
  });

  it("keeps them while the carriers are still reviewing", () => {
    for (const status of ["submitted", "in_review", "not_started"] as const) {
      expect(
        idDeleteAfterOf({ status, approvedAt: null, updatedAt: day("2026-01-01") }),
      ).toBeNull();
    }
  });
});
