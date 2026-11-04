import {
  HANDOFF_SHARED_FIELDS,
  NETWORK_TERMS_VERSION,
  REFERRALS_PER_FREE_MONTH,
  handoffInput,
  networkJoinInput,
  onboardingInput,
  tierAllows,
} from "@leadanchor/contracts";
import { describe, expect, it } from "vitest";
import { areaOf, zipOf } from "./area";

describe("where a passed job is (C-24, guardrail 2)", () => {
  it("finds the ZIP in a typed address", () => {
    expect(zipOf("12 Oak St, Springfield, IL 62704")).toBe("62704");
    expect(zipOf("12 Oak St, Springfield, IL 62704-1234")).toBe("62704");
    expect(zipOf("Apt 12345A")).toBeNull();
    expect(zipOf(null)).toBeNull();
  });

  it("shows the pros a town and ZIP, never the street", () => {
    expect(areaOf({ city: "Springfield", state: "IL" }, "62704")).toBe("Springfield, IL 62704");
    expect(areaOf({ city: null, state: "IL" }, "62704")).toBe("IL 62704");
    expect(areaOf({ city: "Springfield", state: "IL" }, null)).toBe("Springfield, IL");
  });

  it("shares only what the job needs with the pro who accepts", () => {
    expect([...HANDOFF_SHARED_FIELDS]).toEqual(["Name", "Phone number", "Job description", "Address"]);
  });
});

describe("joining and passing", () => {
  it("joins only with the partner terms accepted, and a trade", () => {
    const base = { trades: ["plumbing"], termsVersion: NETWORK_TERMS_VERSION };
    expect(networkJoinInput.safeParse({ ...base, acceptTerms: true }).success).toBe(true);
    expect(networkJoinInput.safeParse({ ...base, acceptTerms: false }).success).toBe(false);
    expect(networkJoinInput.safeParse({ ...base, trades: [], acceptTerms: true }).success).toBe(false);
    expect(networkJoinInput.parse({ ...base, trades: ["plumbing", "plumbing"], acceptTerms: true }).trades).toEqual(["plumbing"]);
  });

  it("passes a job with a trade and an optional short note", () => {
    expect(handoffInput.parse({ trade: "electrical" })).toEqual({ trade: "electrical", note: "" });
    expect(handoffInput.safeParse({ trade: "electrical", note: "x".repeat(301) }).success).toBe(false);
    expect(handoffInput.safeParse({ trade: "astronaut" }).success).toBe(false);
  });
});

describe("referral credits (C-25)", () => {
  it("is a Pro feature, and a free month takes three referrals", () => {
    expect(tierAllows("starter", "referral_credits")).toBe(false);
    expect(tierAllows("pro", "referral_credits")).toBe(true);
    expect(REFERRALS_PER_FREE_MONTH).toBe(3);
  });

  it("carries a referral code through sign-up", () => {
    const input = {
      businessName: "Rivera Plumbing",
      trade: "plumbing",
      ownerName: "Ana Rivera",
      ownerCell: "(512) 555-0142",
      referralCode: " ab12cd34 ",
    };
    expect(onboardingInput.parse(input).referralCode).toBe("ab12cd34");
    expect(onboardingInput.parse({ ...input, referralCode: undefined }).referralCode).toBeUndefined();
  });
});
