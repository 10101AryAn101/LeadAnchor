import { describe, expect, it } from "vitest";
import { NUMBER_GRACE_DAYS, numberReleaseDue } from "./number-rule";

const DAY = 86_400_000;
const now = new Date("2026-12-15T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const business = (overrides: Partial<Parameters<typeof numberReleaseDue>[0]>) => ({
  status: "cancelled" as const,
  isDemo: false,
  billingPeriodEnd: ago(NUMBER_GRACE_DAYS + 1),
  trialEndsAt: ago(90),
  createdAt: ago(120),
  ...overrides,
});

describe("giving a number back when a business leaves", () => {
  it("keeps the number for 30 days after the plan ended, then lets it go", () => {
    expect(NUMBER_GRACE_DAYS).toBe(30);
    expect(numberReleaseDue(business({}), now)).toBe(true);
    expect(numberReleaseDue(business({ billingPeriodEnd: ago(29) }), now)).toBe(false);
  });

  it("dates a plan that never had a billing period from the end of the trial", () => {
    expect(numberReleaseDue(business({ billingPeriodEnd: null, trialEndsAt: ago(31) }), now)).toBe(
      true,
    );
    expect(numberReleaseDue(business({ billingPeriodEnd: null, trialEndsAt: ago(10) }), now)).toBe(
      false,
    );
  });

  it("never takes a number from a business that's still here, on a trial, or a demo", () => {
    expect(numberReleaseDue(business({ status: "active" }), now)).toBe(false);
    expect(numberReleaseDue(business({ status: "past_due" }), now)).toBe(false);
    expect(numberReleaseDue(business({ status: "trial", trialEndsAt: ago(400) }), now)).toBe(false);
    expect(numberReleaseDue(business({ isDemo: true }), now)).toBe(false);
  });
});
