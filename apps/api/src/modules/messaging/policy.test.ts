import { describe, expect, it } from "vitest";
import { type PolicyFacts, decide } from "./policy";

const base: PolicyFacts = {
  purpose: "transactional",
  preferredChannels: ["sms", "whatsapp"],
  smsConsent: "GRANTED",
  carrierApproved: true,
  whatsappWindowOpen: false,
  whatsappConfigured: false,
  recipientLocalHour: 14,
};

describe("send policy (governed send path)", () => {
  it("sends a transactional text when consent and carrier approval are in place", () => {
    const decision = decide(base);
    expect(decision.allowed).toBe(true);
    expect(decision.channel).toBe("sms");
  });

  it("blocks texts until carriers approve the business (10DLC hard block)", () => {
    const decision = decide({ ...base, carrierApproved: false });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/carriers approve/i);
  });

  it("never texts someone with no consent on record", () => {
    expect(decide({ ...base, smsConsent: null }).allowed).toBe(false);
  });

  it("honours STOP immediately", () => {
    const decision = decide({ ...base, smsConsent: "REVOKED" });
    expect(decision.allowed).toBe(false);
    expect(decision.checks.find((c) => c.check === "sms_consent")?.detail).toMatch(/opted out/i);
  });

  it("keeps marketing texts off under the email-first plan", () => {
    expect(decide({ ...base, purpose: "marketing" }).allowed).toBe(false);
  });

  it("falls back to WhatsApp only inside the customer's 24-hour window", () => {
    const blockedSms = { ...base, carrierApproved: false, whatsappConfigured: true };
    expect(decide({ ...blockedSms, whatsappWindowOpen: false }).allowed).toBe(false);
    const decision = decide({ ...blockedSms, whatsappWindowOpen: true });
    expect(decision.allowed).toBe(true);
    expect(decision.channel).toBe("whatsapp");
  });

  it("records every check it made, so the decision can be audited", () => {
    const decision = decide({ ...base, carrierApproved: false });
    expect(decision.checks.map((c) => c.check)).toEqual(expect.arrayContaining(["quiet_hours", "sms_consent", "carrier_registration"]));
  });
});
