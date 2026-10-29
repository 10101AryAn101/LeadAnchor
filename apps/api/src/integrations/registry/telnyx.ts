import { type BrandSubmission, type CampaignSubmission, type CarrierRegistry, RegistryRejection, type ReviewState } from "./types";

const API = "https://api.telnyx.com/v2";

/** Sub-use-cases of the "Low Volume Mixed" campaign the spec asks for (C-43). */
const MIXED_SUB_USECASES = ["CUSTOMER_CARE", "ACCOUNT_NOTIFICATION", "DELIVERY_NOTIFICATION", "MARKETING"];

/** Campaign states that end the review with a "no". */
const CAMPAIGN_FAILED = new Set(["TCR_FAILED", "TCR_SUSPENDED", "TCR_EXPIRED", "TELNYX_FAILED", "MNO_REJECTED", "MNO_PROVISIONING_FAILED"]);

class TelnyxApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Telnyx 10DLC request failed (${status}): ${detail}`);
  }
}

/**
 * Telnyx 10DLC API: Telnyx files brands and campaigns with The Campaign Registry
 * and the mobile carriers. Docs: developers.telnyx.com → Messaging → 10DLC.
 * Written to the documented API; it runs once a Telnyx account is connected.
 */
export class TelnyxRegistry implements CarrierRegistry {
  readonly name = "telnyx" as const;

  constructor(private readonly apiKey: string) {}

  async submitBrand(input: BrandSubmission, existingBrandId: string | null) {
    const body = brandBody(input);
    try {
      if (existingBrandId) {
        // A brand the carriers turned down is corrected in place and checked again.
        await this.request("PUT", `/10dlc/brand/${encodeURIComponent(existingBrandId)}`, body);
        await this.request("PUT", `/10dlc/brand/${encodeURIComponent(existingBrandId)}/revet`);
        return { brandId: existingBrandId };
      }
      const brand = await this.request<{ brandId?: string }>("POST", "/10dlc/brand", body);
      if (!brand.brandId) throw new Error("Telnyx did not return a brand ID.");
      return { brandId: brand.brandId };
    } catch (error) {
      throw asRejection(error);
    }
  }

  async brandStatus(brandId: string) {
    return brandReview(await this.request("GET", `/10dlc/brand/${encodeURIComponent(brandId)}`));
  }

  async sendOtp(brandId: string, businessName: string) {
    await this.request("POST", `/10dlc/brand/${encodeURIComponent(brandId)}/smsOtp`, {
      pinSms: `${businessName.slice(0, 60)}: your carrier registration code is @OTP_PIN@. Enter it in LeadAnchor to confirm your number.`,
      successSms: "Thanks, your number is confirmed. We'll let you know when carriers approve your texting.",
    });
  }

  async verifyOtp(brandId: string, code: string) {
    try {
      await this.request("PUT", `/10dlc/brand/${encodeURIComponent(brandId)}/smsOtp`, { otpPin: code });
      return true;
    } catch (error) {
      // 400 is "invalid or expired code"; anything else is a real failure.
      if (error instanceof TelnyxApiError && error.status === 400) return false;
      throw error;
    }
  }

  async createCampaign(input: CampaignSubmission) {
    const soleProprietor = input.path === "sole_proprietor";
    const samples = Object.fromEntries(input.samples.slice(0, 5).map((text, index) => [`sample${index + 1}`, text]));
    try {
      const campaign = await this.request<{ campaignId?: string }>("POST", "/10dlc/campaignBuilder", {
        brandId: input.brandId,
        usecase: soleProprietor ? "SOLE_PROPRIETOR" : "LOW_VOLUME",
        subUsecases: soleProprietor ? [] : MIXED_SUB_USECASES,
        description: input.description,
        messageFlow: input.messageFlow,
        ...samples,
        helpMessage: input.helpMessage,
        optinMessage: input.optinMessage,
        optoutMessage: input.optoutMessage,
        helpKeywords: "HELP",
        optinKeywords: "START",
        optoutKeywords: "STOP",
        subscriberHelp: true,
        subscriberOptin: true,
        subscriberOptout: true,
        embeddedLink: true,
        embeddedPhone: false,
        numberPool: false,
        ageGated: false,
        directLending: false,
        termsAndConditions: true,
        privacyPolicyLink: input.privacyPolicyUrl,
        termsAndConditionsLink: input.termsUrl,
      });
      if (!campaign.campaignId) throw new Error("Telnyx did not return a campaign ID.");
      return { campaignId: campaign.campaignId };
    } catch (error) {
      throw asRejection(error);
    }
  }

  async campaignStatus(campaignId: string) {
    return campaignReview(await this.request("GET", `/10dlc/campaign/${encodeURIComponent(campaignId)}`));
  }

  async assignNumber(campaignId: string, phoneE164: string) {
    await this.request("POST", "/10dlc/phone_number_campaigns", { phoneNumber: phoneE164, campaignId });
  }

  async numberStatus(phoneE164: string) {
    return numberReview(await this.request("GET", `/10dlc/phone_number_campaigns/${encodeURIComponent(phoneE164)}`));
  }

  private async request<T = Record<string, unknown>>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json().catch(() => ({}))) as { data?: T; errors?: Array<{ title?: string; detail?: string }>; detail?: unknown };
    if (!response.ok) {
      const error = json.errors?.[0];
      throw new TelnyxApiError(response.status, error?.detail ?? error?.title ?? (typeof json.detail === "string" ? json.detail : "unknown error"));
    }
    // 10DLC endpoints answer with the object itself; some wrap it in `data`.
    return (json.data ?? json) as T;
  }
}

/** Bad data (4xx other than auth/limits) means the owner has to fix something; the rest is retried. */
function asRejection(error: unknown) {
  if (error instanceof TelnyxApiError && (error.status === 400 || error.status === 422)) return new RegistryRejection(error.detail);
  return error;
}

function brandBody(input: BrandSubmission) {
  return {
    entityType: input.entityType,
    displayName: input.displayName.slice(0, 100),
    companyName: input.companyName ?? undefined,
    ein: input.ein?.replace(/\D/g, "") ?? undefined,
    firstName: input.firstName ?? undefined,
    lastName: input.lastName ?? undefined,
    phone: input.phone,
    mobilePhone: input.mobilePhone ?? undefined,
    email: input.email,
    website: input.website || undefined,
    street: input.street,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: "US",
    vertical: input.vertical,
  };
}

export function brandReview(brand: { status?: string; identityStatus?: string; entityType?: string; failureReasons?: string | null }): ReviewState {
  if (brand.status === "REGISTRATION_FAILED") return { state: "failed", reason: brand.failureReasons ?? null };
  if (brand.identityStatus === "VERIFIED" || brand.identityStatus === "VETTED_VERIFIED") return { state: "passed" };
  // A registered brand whose identity check failed. Sole proprietors are verified by their code instead.
  if (brand.status === "OK" && brand.identityStatus === "UNVERIFIED" && brand.entityType !== "SOLE_PROPRIETOR") {
    return { state: "failed", reason: brand.failureReasons ?? "Identity could not be verified." };
  }
  return { state: "pending" };
}

export function campaignReview(campaign: { campaignStatus?: string; submissionStatus?: string; failureReasons?: string | null }): ReviewState {
  if (campaign.submissionStatus === "FAILED" || CAMPAIGN_FAILED.has(campaign.campaignStatus ?? "")) {
    return { state: "failed", reason: campaign.failureReasons ?? campaign.campaignStatus ?? null };
  }
  return campaign.campaignStatus === "MNO_PROVISIONED" ? { state: "passed" } : { state: "pending" };
}

export function numberReview(assignment: { assignmentStatus?: string; failureReasons?: string | null }): ReviewState {
  if (assignment.assignmentStatus === "ASSIGNED") return { state: "passed" };
  if (assignment.assignmentStatus === "FAILED_ASSIGNMENT") return { state: "failed", reason: assignment.failureReasons ?? null };
  return { state: "pending" };
}
