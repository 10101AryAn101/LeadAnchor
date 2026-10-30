import type { IntegrationStatus, RegistrationStatus } from "@leadanchor/contracts";
import { env } from "../../config/env";
import { ai, calendarProviders, channels, consentLedger, holidays, listingProviders, payments, pdf, registry, weather } from "../../container";

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
      purpose: "Customers chat with the business on WhatsApp; the assistant answers inside the 24-hour window, and the owner can take over.",
      capabilities: ["C-07", "C-11", "C-16", "C-21", "C-31"],
      state: channels.whatsapp?.provider === "meta" ? "live" : channels.whatsapp ? "simulated" : "not_configured",
      detail:
        channels.whatsapp?.provider === "meta"
          ? "Connected to Meta Cloud API."
          : channels.whatsapp
            ? "A simulated WhatsApp stands in (Chats and the call simulator). Real WhatsApp needs a Meta Business account, a WhatsApp number and the API keys (free to set up, step 2)."
            : "Needs a Meta Business account (directly or through a BSP).",
      mandatedBySpec: true,
    },
    {
      key: "google_business_profile",
      name: "Google Business Profile",
      purpose: "Keeps hours, phone, website, address and the Book link up to date on Google; reads reviews in; posts approved replies and updates.",
      capabilities: ["C-10", "C-21", "C-23", "C-41", "C-46", "C-47"],
      state: listingProviders.google ? "live" : "simulated",
      detail: listingProviders.google
        ? "Connected to the Google Business Profile API."
        : "Reviews, AI-drafted replies, review requests and listing updates run on a simulated Google listing until Google approves API access and each business signs in (free, step 2).",
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
      purpose: "Reads voicemails, call answers and customer photos; drafts quotes and review replies; answers chats.",
      capabilities: ["C-09", "C-13", "C-16", "C-39", "C-45", "C-47"],
      state: ai.configured ? "live" : "not_configured",
      detail: ai.configured ? `Model ${ai.model}.` : "Add GEMINI_API_KEY to enable AI summaries.",
      mandatedBySpec: false,
    },
    {
      key: "scheduler",
      name: "Calendars (Google Calendar, Microsoft Outlook)",
      purpose: "Two-way sync: bookings go into the owner's calendar, and its busy times keep customers from booking over them.",
      capabilities: ["C-18", "C-19", "C-20", "C-22"],
      state: calendarProviders.google || calendarProviders.microsoft ? "live" : "simulated",
      detail:
        calendarProviders.google || calendarProviders.microsoft
          ? "Owners connect their own calendar in Settings → Online booking."
          : "Booking, reminders and the waitlist run on LeadAnchor's own scheduling; a simulated calendar stands in for Google and Outlook until they're set up (free, step 2).",
      mandatedBySpec: true,
    },
    {
      key: "email",
      name: "Transactional email",
      purpose: "Your weekly summary, receipts, review requests and email campaigns, with bounce and spam-report handling.",
      capabilities: ["C-40", "C-28", "C-29", "C-30", "C-44", "C-46"],
      state: channels.email.provider === "outbox" ? "simulated" : "live",
      detail:
        channels.email.provider === "outbox"
          ? "No email service is connected yet. Emails are kept in the Email outbox (under Business), where you can also make one bounce or be marked as spam to see how LeadAnchor reacts."
          : env.EMAIL_TEST_RECIPIENT
            ? `Test mode: emails go out through Resend, all of them to ${env.EMAIL_TEST_RECIPIENT}. Bounces and spam reports come back to LeadAnchor.`
            : "Emails go out through the connected email service; bounces and spam reports come back to LeadAnchor.",
      mandatedBySpec: true,
    },
    {
      key: "weather",
      name: "Weather forecasts",
      purpose: "Spots a freeze or heat wave coming to your town and drafts a timely offer for you to approve.",
      capabilities: ["C-30"],
      state: weather.name === "simulator" ? "simulated" : "live",
      detail:
        weather.name === "simulator"
          ? "A simulated forecast stands in until the US National Weather Service is connected (free, no key, step 2). Dev tools can bring on a cold snap or heat wave."
          : "Forecasts come from the US National Weather Service.",
      mandatedBySpec: true,
    },
    {
      key: "holidays",
      name: "Holiday calendar",
      purpose: "Drafts an offer a couple of weeks before holidays that matter to your trade.",
      capabilities: ["C-30"],
      state: holidays.name === "simulator" ? "simulated" : "live",
      detail:
        holidays.name === "simulator"
          ? "A built-in US holiday calendar stands in until a holiday API is connected (free, step 2)."
          : "Holidays come from the connected holiday API.",
      mandatedBySpec: true,
    },
  ];
}
