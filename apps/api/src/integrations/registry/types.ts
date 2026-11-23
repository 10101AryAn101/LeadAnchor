import type { RegistrationPath, RegistryTestOutcome } from "@leadanchor/contracts";

/**
 * Carrier registry port (A2P 10DLC, C-43). A business is registered as a brand,
 * gets a texting campaign, and has its number attached to that campaign.
 * Telnyx files with The Campaign Registry for us; the simulator plays the carriers.
 */

export type RegistryName = "telnyx" | "simulator";

export interface BrandSubmission {
  path: RegistrationPath;
  entityType: "PRIVATE_PROFIT" | "PUBLIC_PROFIT" | "NON_PROFIT" | "SOLE_PROPRIETOR";
  /** The name customers know the business by. */
  displayName: string;
  /** Legal name on IRS records (businesses with an EIN). */
  companyName: string | null;
  /** NN-NNNNNNN (businesses with an EIN). */
  ein: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Sole proprietors: the one-time code is texted here. */
  mobilePhone: string | null;
  phone: string;
  email: string;
  website: string | null;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  /** TCR industry vertical, e.g. CONSTRUCTION. */
  vertical: string;
  /** Simulator only: what the pretend carriers decide. Real registries ignore it. */
  testOutcome?: RegistryTestOutcome;
}

export interface CampaignSubmission {
  brandId: string;
  path: RegistrationPath;
  description: string;
  messageFlow: string;
  /** Two to five example messages. */
  samples: string[];
  helpMessage: string;
  optinMessage: string;
  optoutMessage: string;
  privacyPolicyUrl: string;
  termsUrl: string;
  testOutcome?: RegistryTestOutcome;
}

/** Where one review step stands. `reason` is the registry's own words, kept for the audit trail. */
export type ReviewState = { state: "pending" } | { state: "passed" } | { state: "failed"; reason: string | null };

export interface CarrierRegistry {
  readonly name: RegistryName;
  /** Creates the brand, or corrects and re-checks one the carriers turned down. */
  submitBrand(input: BrandSubmission, existingBrandId: string | null): Promise<{ brandId: string }>;
  brandStatus(brandId: string): Promise<ReviewState>;
  /** Sole proprietors: texts a one-time code to the brand's mobile number. */
  sendOtp(brandId: string, businessName: string): Promise<void>;
  /** False when the code is wrong or has expired. */
  verifyOtp(brandId: string, code: string): Promise<boolean>;
  createCampaign(input: CampaignSubmission): Promise<{ campaignId: string }>;
  campaignStatus(campaignId: string): Promise<ReviewState>;
  assignNumber(campaignId: string, phoneE164: string): Promise<void>;
  numberStatus(phoneE164: string): Promise<ReviewState>;
}

/** The registry refused the submission itself: something in the owner's details has to change. */
export class RegistryRejection extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "RegistryRejection";
  }
}
