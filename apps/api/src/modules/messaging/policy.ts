import type { ConsentAction, MessageChannel, MessagePurpose } from "@leadanchor/contracts";

/**
 * The send policy — the single place that decides whether a message may go out
 * and on which channel (PDF §5: "all outbound traffic must pass through one
 * governed path where policy is enforced"). Pure function: easy to test and audit.
 */

export interface PolicyFacts {
  purpose: MessagePurpose;
  /** Channels the caller would like, in order of preference. */
  preferredChannels: MessageChannel[];
  /** Latest consent ledger action for SMS of this purpose (null = never recorded). */
  smsConsent: ConsentAction | null;
  /** A2P 10DLC campaign approved for this business (C-43). */
  carrierApproved: boolean;
  /** Customer messaged us on WhatsApp within the last 24 hours (C-11). */
  whatsappWindowOpen: boolean;
  whatsappConfigured: boolean;
  /** Recipient's local hour, for quiet hours on marketing. */
  recipientLocalHour: number;
  /** Counsel has confirmed the waitlist opt-in wording covers texts (C-22). Platform-wide. */
  waitlistTextsCleared: boolean;
}

export interface PolicyCheck {
  check: string;
  passed: boolean;
  detail: string;
}

export interface PolicyDecision {
  allowed: boolean;
  channel: MessageChannel | null;
  reason: string | null;
  checks: PolicyCheck[];
}

const QUIET_START = 21; // 9 pm
const QUIET_END = 8; // 8 am

export function decide(facts: PolicyFacts): PolicyDecision {
  const checks: PolicyCheck[] = [];
  const blocked = (reason: string): PolicyDecision => ({ allowed: false, channel: null, reason, checks });

  if (facts.purpose === "marketing") {
    // Email-first strategy: marketing texts stay off until counsel signs off on the TCPA consent stack.
    checks.push({ check: "marketing_channel", passed: false, detail: "Marketing runs on email until SMS marketing is legally cleared." });
    return blocked("Marketing texts are switched off (email-first plan).");
  }

  if (facts.purpose === "waitlist_offer") {
    // Spreadsheet rollout for C-22: email and in-app now; texts once counsel confirms the opt-in.
    checks.push({
      check: "waitlist_texts",
      passed: facts.waitlistTextsCleared,
      detail: facts.waitlistTextsCleared ? "Waitlist texts are cleared." : "Waitlist texts wait for counsel to confirm the opt-in wording.",
    });
    if (!facts.waitlistTextsCleared) return blocked("Waitlist texts are off until legal sign-off, so the offer goes by email.");
  }

  const quiet = facts.recipientLocalHour >= QUIET_START || facts.recipientLocalHour < QUIET_END;
  checks.push({ check: "quiet_hours", passed: true, detail: quiet ? "Quiet hours, but transactional messages are allowed." : "Outside quiet hours." });

  for (const channel of facts.preferredChannels) {
    if (channel === "sms" || channel === "rcs") {
      // Answering the customer's own STOP, START or HELP is the one text that needs no prior consent.
      const keywordReply = facts.purpose === "keyword_reply";
      const consentOk = keywordReply || facts.smsConsent === "GRANTED";
      checks.push({
        check: "sms_consent",
        passed: consentOk,
        detail: keywordReply
          ? "Reply to the customer's own STOP, START or HELP."
          : consentOk
            ? "Customer agreed to texts (consent ledger)."
            : facts.smsConsent === "REVOKED"
              ? "Customer opted out (STOP)."
              : "No consent on record for texts.",
      });
      if (!consentOk) continue;

      checks.push({
        check: "carrier_registration",
        passed: facts.carrierApproved,
        detail: facts.carrierApproved ? "Carrier registration approved." : "Texting is blocked until carriers approve the business (10DLC).",
      });
      if (!facts.carrierApproved) continue;

      return { allowed: true, channel: "sms", reason: null, checks };
    }

    if (channel === "whatsapp") {
      const ok = facts.whatsappConfigured && facts.whatsappWindowOpen;
      checks.push({
        check: "whatsapp_window",
        passed: ok,
        detail: !facts.whatsappConfigured
          ? "WhatsApp is not connected yet."
          : ok
            ? "Customer messaged in the last 24 hours."
            : "WhatsApp only allows replies within 24 hours of the customer's message.",
      });
      if (ok) return { allowed: true, channel: "whatsapp", reason: null, checks };
    }
  }

  // Report the first failed check: it belongs to the preferred channel, which is what the owner expects.
  const failed = checks.filter((c) => !c.passed).map((c) => c.detail);
  return blocked(failed[0] ?? "No allowed channel for this message.");
}
