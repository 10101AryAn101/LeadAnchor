import { createHash, randomBytes } from "node:crypto";
import type { BrandSubmission, CampaignSubmission, CarrierRegistry, ReviewState } from "./types";

/** How long each pretend review takes. Real ones take days to weeks. */
export const SIM_BRAND_REVIEW_MS = 15_000;
export const SIM_CAMPAIGN_REVIEW_MS = 20_000;
export const SIM_NUMBER_SETUP_MS = 5_000;

/**
 * Plays the carriers locally. Each ID carries its own creation time and planned
 * outcome, so reviews keep their timeline across API restarts without any storage.
 */
export class SimulatorRegistry implements CarrierRegistry {
  readonly name = "simulator" as const;
  private readonly assignedAt = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async submitBrand(input: BrandSubmission) {
    return { brandId: simId("brand", this.now(), input.testOutcome === "reject_brand") };
  }

  async brandStatus(brandId: string): Promise<ReviewState> {
    return this.review(brandId, SIM_BRAND_REVIEW_MS, "Tax ID does not match the company name on IRS records.");
  }

  async sendOtp() {
    // The code is shown in the app's simulator box instead of being texted (see otpFor).
  }

  async verifyOtp(brandId: string, code: string) {
    return code.trim() === this.otpFor(brandId);
  }

  /** The 6-digit code the pretend carriers "texted" for this brand. */
  otpFor(brandId: string) {
    return String(createHash("sha256").update(brandId).digest().readUInt32BE(0) % 1_000_000).padStart(6, "0");
  }

  async createCampaign(input: CampaignSubmission) {
    return { campaignId: simId("campaign", this.now(), input.testOutcome === "reject_campaign") };
  }

  async campaignStatus(campaignId: string): Promise<ReviewState> {
    return this.review(campaignId, SIM_CAMPAIGN_REVIEW_MS, "MNO rejected: message samples do not match the declared use case.");
  }

  async assignNumber(_campaignId: string, phoneE164: string) {
    this.assignedAt.set(phoneE164, this.now());
  }

  async numberStatus(phoneE164: string): Promise<ReviewState> {
    // Unknown after a restart: by then the short setup has long finished.
    const at = this.assignedAt.get(phoneE164);
    return at !== undefined && this.now() - at < SIM_NUMBER_SETUP_MS ? { state: "pending" } : { state: "passed" };
  }

  private review(id: string, takesMs: number, failure: string): ReviewState {
    const parsed = parseSimId(id);
    if (!parsed) return { state: "failed", reason: "Unknown registration ID." };
    if (this.now() - parsed.createdAt < takesMs) return { state: "pending" };
    return parsed.fails ? { state: "failed", reason: failure } : { state: "passed" };
  }
}

const simId = (kind: "brand" | "campaign", createdAt: number, fails: boolean) =>
  `sim-${kind}-${createdAt.toString(36)}-${fails ? "f" : "p"}${randomBytes(3).toString("hex")}`;

function parseSimId(id: string) {
  const [prefix, , time, rest] = id.split("-");
  const createdAt = Number.parseInt(time ?? "", 36);
  if (prefix !== "sim" || !Number.isFinite(createdAt) || !rest) return null;
  return { createdAt, fails: rest.startsWith("f") };
}
