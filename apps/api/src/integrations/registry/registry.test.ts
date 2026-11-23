import { describe, expect, it } from "vitest";
import { campaignContent, keywordReplies, plainFailure } from "../../modules/compliance/registration-copy";
import { SIM_BRAND_REVIEW_MS, SIM_CAMPAIGN_REVIEW_MS, SimulatorRegistry } from "./simulator";
import { brandReview, campaignReview, numberReview } from "./telnyx";
import type { BrandSubmission } from "./types";

const brand: BrandSubmission = {
  path: "standard",
  entityType: "PRIVATE_PROFIT",
  displayName: "Demo Plumbing",
  companyName: "Demo Plumbing LLC",
  ein: "12-3456789",
  firstName: null,
  lastName: null,
  mobilePhone: null,
  phone: "+15125550101",
  email: "owner@example.com",
  website: null,
  street: "1 Main St",
  city: "Austin",
  state: "TX",
  postalCode: "78701",
  vertical: "CONSTRUCTION",
};

describe("registry simulator (C-43)", () => {
  it("keeps a brand in review, then approves it", async () => {
    let now = 1_000_000;
    const registry = new SimulatorRegistry(() => now);
    const { brandId } = await registry.submitBrand(brand);
    expect(await registry.brandStatus(brandId)).toEqual({ state: "pending" });
    now += SIM_BRAND_REVIEW_MS;
    expect(await registry.brandStatus(brandId)).toEqual({ state: "passed" });
  });

  it("turns down what the tester asked it to", async () => {
    let now = 1_000_000;
    const registry = new SimulatorRegistry(() => now);
    const { brandId } = await registry.submitBrand({ ...brand, testOutcome: "reject_brand" });
    const { campaignId } = await registry.createCampaign({ ...campaignContent({ businessName: "Demo", path: "standard", webUrl: "http://x" }), brandId, path: "standard", testOutcome: "reject_campaign" });
    now += Math.max(SIM_BRAND_REVIEW_MS, SIM_CAMPAIGN_REVIEW_MS);
    expect(await registry.brandStatus(brandId)).toMatchObject({ state: "failed" });
    expect(await registry.campaignStatus(campaignId)).toMatchObject({ state: "failed" });
  });

  it("accepts only the code it 'texted' a sole proprietor", async () => {
    const registry = new SimulatorRegistry();
    const { brandId } = await registry.submitBrand({ ...brand, path: "sole_proprietor", entityType: "SOLE_PROPRIETOR" });
    const code = registry.otpFor(brandId);
    expect(code).toMatch(/^\d{6}$/);
    expect(await registry.verifyOtp(brandId, code)).toBe(true);
    expect(await registry.verifyOtp(brandId, code === "000000" ? "111111" : "000000")).toBe(false);
  });

  it("survives a restart: the timeline lives in the ID", async () => {
    let now = 1_000_000;
    const { brandId } = await new SimulatorRegistry(() => now).submitBrand(brand);
    now += SIM_BRAND_REVIEW_MS;
    expect(await new SimulatorRegistry(() => now).brandStatus(brandId)).toEqual({ state: "passed" });
  });
});

describe("Telnyx 10DLC states in plain terms", () => {
  it("reads brand states", () => {
    expect(brandReview({ status: "REGISTRATION_PENDING", identityStatus: "UNVERIFIED" })).toEqual({ state: "pending" });
    expect(brandReview({ status: "OK", identityStatus: "VERIFIED" })).toEqual({ state: "passed" });
    expect(brandReview({ status: "OK", identityStatus: "VETTED_VERIFIED" })).toEqual({ state: "passed" });
    expect(brandReview({ status: "REGISTRATION_FAILED", failureReasons: "Tax ID mismatch" })).toEqual({ state: "failed", reason: "Tax ID mismatch" });
    expect(brandReview({ status: "OK", identityStatus: "UNVERIFIED", entityType: "PRIVATE_PROFIT" })).toMatchObject({ state: "failed" });
    // Sole proprietors are verified by their code, so an unverified one is still waiting.
    expect(brandReview({ status: "OK", identityStatus: "UNVERIFIED", entityType: "SOLE_PROPRIETOR" })).toEqual({ state: "pending" });
  });

  it("treats a campaign as approved only once the carriers have provisioned it", () => {
    expect(campaignReview({ campaignStatus: "TCR_ACCEPTED" })).toEqual({ state: "pending" });
    expect(campaignReview({ campaignStatus: "MNO_PENDING" })).toEqual({ state: "pending" });
    expect(campaignReview({ campaignStatus: "MNO_PROVISIONED" })).toEqual({ state: "passed" });
    expect(campaignReview({ campaignStatus: "MNO_REJECTED", failureReasons: "Samples unclear" })).toEqual({ state: "failed", reason: "Samples unclear" });
    expect(campaignReview({ submissionStatus: "FAILED" })).toMatchObject({ state: "failed" });
  });

  it("reads number assignment", () => {
    expect(numberReview({ assignmentStatus: "PENDING_ASSIGNMENT" })).toEqual({ state: "pending" });
    expect(numberReview({ assignmentStatus: "ASSIGNED" })).toEqual({ state: "passed" });
    expect(numberReview({ assignmentStatus: "FAILED_ASSIGNMENT", failureReasons: "Not a 10DLC number" })).toMatchObject({ state: "failed" });
  });
});

describe("what the owner and the carriers read", () => {
  it("explains a turned-down business in plain words", () => {
    expect(plainFailure("brand", "Tax ID does not match the company name")).toMatch(/EIN/);
    expect(plainFailure("brand", "Address could not be validated")).toMatch(/address/);
    expect(plainFailure("brand", "OTP verification expired")).toMatch(/mobile/);
    expect(plainFailure("brand", null)).toMatch(/send again/);
    expect(plainFailure("campaign", "MNO_REJECTED")).not.toMatch(/MNO/);
  });

  it("files a campaign that matches what LeadAnchor sends", () => {
    const content = campaignContent({ businessName: "Demo Plumbing", path: "standard", webUrl: "https://app.example.com" });
    expect(content.privacyPolicyUrl).toBe("https://app.example.com/privacy");
    expect(content.messageFlow).toContain("https://app.example.com/terms");
    expect(content.samples.length).toBeGreaterThanOrEqual(2);
    expect(content.samples.every((sample) => sample.startsWith("Demo Plumbing:"))).toBe(true);
    expect(content.helpMessage).toBe(keywordReplies("Demo Plumbing").help);
    // Sole-proprietor campaigns don't cover offers.
    expect(campaignContent({ businessName: "Ann", path: "sole_proprietor", webUrl: "https://x" }).samples).toHaveLength(2);
  });
});
