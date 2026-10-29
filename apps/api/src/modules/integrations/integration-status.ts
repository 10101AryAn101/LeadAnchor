import type { IntegrationStatus, RegistrationStatus } from "@leadanchor/contracts";
import { env } from "../../config/env";
import { ai, channels, consentLedger, payments, pdf, registry } from "../../container";

/**
 * Honest status of every third-party service the spec names: live, simulated
 * locally, waiting for credentials, or planned for a later phase.
 */
export function integrationStatuses(registration: RegistrationStatus): IntegrationStatus[] {
  const telnyxLive = env.TELEPHONY_PROVIDER === "telnyx";
  return [
    {
      key: "telnyx",
      name: "Telnyx",
      purpose: "Business phone numbers, call handling, SMS and voicemail transcription.",
      capabilities: ["C-02", "C-03", "C-05", "C-06", "C-13", "C-39"],
      state: telnyxLive ? "live" : "simulated",
      detail: telnyxLive
        ? "Connected — calls arrive through the Telnyx webhook."
        : "Running on the local call simulator. Add TELNYX_API_KEY and switch TELEPHONY_PROVIDER to go live.",
      mandatedBySpec: true,
    },
    {
      key: "carrier_registry",
      name: "Carrier registration (10DLC)",
      purpose: "Registers each business with US carriers so automatic texts are allowed.",
      capabilities: ["C-43"],
      state: registry.name === "telnyx" ? (registration === "approved" ? "live" : "not_configured") : "simulated",
      detail:
        registration === "approved"
          ? "Approved — texts can be sent."
          : registry.name === "simulator"
            ? "Running on the local registry simulator: a review takes about a minute. Texts stay blocked until it approves."
            : "Texts stay blocked until the carriers approve this business.",
      mandatedBySpec: true,
    },
    {
      key: "whatsapp",
      name: "WhatsApp Business Platform",
      purpose: "Customer chats, photos and replies inside the 24-hour window.",
      capabilities: ["C-07", "C-11", "C-31"],
      state: channels.whatsapp ? "live" : "not_configured",
      detail: channels.whatsapp ? "Connected to Meta Cloud API." : "Needs a Meta Business account (directly or through a BSP).",
      mandatedBySpec: true,
    },
    {
      key: "google_business_profile",
      name: "Google Business Profile",
      purpose: "Booking link on Google, hours sync and reviews.",
      capabilities: ["C-10", "C-21", "C-47"],
      state: env.GBP_CLIENT_ID ? "not_configured" : "planned",
      detail:
        "Each business already has a Google request link to paste into its profile (Settings → Website & Google). Adding it automatically, hours sync and reviews need Google's API approval and sign-in per business.",
      mandatedBySpec: true,
    },
    {
      key: "stripe",
      name: "Stripe",
      purpose: "Card deposits and pay links (each business gets its own Stripe account), and later membership plans and referral credits.",
      capabilities: ["C-15", "C-25", "C-26", "C-45", "C-48–C-52"],
      state: payments.name === "stripe" ? "live" : "simulated",
      detail:
        payments.name === "stripe"
          ? "Connected. Customers pay on Stripe's own checkout page."
          : `Running on the built-in Stripe simulator: hosted checkout, deposits held on cards, and each business's own payments account. Card numbers are never typed into LeadAnchor.${pdf.available ? "" : " Quote PDFs need Chrome or Edge on the server (PDF_BROWSER_PATH)."}`,
      mandatedBySpec: true,
    },
    {
      key: "firebase",
      name: "Firebase (push + consent ledger)",
      purpose: "High-priority owner alerts (FCM) and the consent ledger.",
      capabilities: ["C-05", "C-27"],
      state: env.FCM_ENABLED || consentLedger.backend === "firestore" ? "live" : "simulated",
      detail: [
        env.FCM_ENABLED ? "Phone alerts go out through Firebase Cloud Messaging." : "Phone alerts are simulated: they show while LeadAnchor is open in a tab.",
        consentLedger.backend === "firestore" ? "Consent ledger on Firestore." : "Consent is kept in the local append-only ledger.",
      ].join(" "),
      mandatedBySpec: true,
    },
    {
      key: "gemini",
      name: "Google Gemini",
      purpose: "Reads voicemails, call answers and customer photos.",
      capabilities: ["C-09", "C-13", "C-39"],
      state: ai.configured ? "live" : "not_configured",
      detail: ai.configured ? `Model ${ai.model}.` : "Add GEMINI_API_KEY to enable AI summaries.",
      mandatedBySpec: false,
    },
    {
      key: "scheduler",
      name: "Scheduling (Calendly / Jobber / Acuity)",
      purpose: "Real availability and self-booking for appointment businesses.",
      capabilities: ["C-18", "C-19", "C-20"],
      state: "planned",
      detail: "Planned for the workflow-and-money phase.",
      mandatedBySpec: true,
    },
    {
      key: "email",
      name: "Transactional email",
      purpose: "Your weekly summary, receipts, review requests and email-first marketing.",
      capabilities: ["C-40", "C-28", "C-46"],
      state: "simulated",
      detail: "No email service is connected yet. Emails are kept in the Email outbox (under Business) so you can read what would have been sent.",
      mandatedBySpec: true,
    },
  ];
}
