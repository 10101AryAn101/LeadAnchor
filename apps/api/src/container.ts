import { resolve } from "node:path";
import { env, linkBaseUrl } from "./config/env";
import { GeminiProvider } from "./integrations/ai/gemini";
import type { AiProvider } from "./integrations/ai/types";
import { SimulatorCalendar } from "./integrations/calendar/simulator";
import type { CalendarProvider } from "./integrations/calendar/types";
import { SimulatorHolidays } from "./integrations/holidays/simulator";
import type { HolidayProvider } from "./integrations/holidays/types";
import { SimulatorListings } from "./integrations/listings/simulator";
import type { ListingProvider } from "./integrations/listings/types";
import { ChromiumPdf, type PdfRenderer, findBrowser } from "./integrations/documents/pdf";
import { FirestoreConsentLedger, MirroredConsentLedger } from "./integrations/firebase/firestore-consent-ledger";
import { OutboxEmail } from "./integrations/messaging/email";
import { ResendEmail } from "./integrations/messaging/resend";
import { SimulatorSms, TelnyxSms } from "./integrations/messaging/sms";
import type { ChannelAdapter, WhatsAppAdapter } from "./integrations/messaging/types";
import { MetaWhatsApp, SimulatorWhatsApp } from "./integrations/messaging/whatsapp";
import { WebChat } from "./integrations/messaging/web-chat";
import { SimulatorPayments } from "./integrations/payments/simulator";
import { StripePayments } from "./integrations/payments/stripe";
import type { PaymentsProvider } from "./integrations/payments/types";
import { FcmPush } from "./integrations/push/fcm";
import { SimulatedPush } from "./integrations/push/simulator";
import type { PushProvider } from "./integrations/push/types";
import { SimulatorWeather } from "./integrations/weather/simulator";
import type { WeatherProvider } from "./integrations/weather/types";
import { SimulatorRegistry } from "./integrations/registry/simulator";
import { TelnyxRegistry } from "./integrations/registry/telnyx";
import type { CarrierRegistry } from "./integrations/registry/types";
import { LocalBlobStorage } from "./integrations/storage/local";
import { SimulatorTelephony } from "./integrations/telephony/simulator";
import { TelnyxTelephony } from "./integrations/telephony/telnyx";
import type { TelephonyProvider } from "./integrations/telephony/types";
import { type ConsentLedger, LocalConsentLedger } from "./modules/compliance/consent-ledger";

/**
 * Composition root: picks one adapter per port from configuration.
 * Business modules import these instances and never construct providers themselves.
 */

export const ai: AiProvider = new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL, env.GEMINI_TIMEOUT_MS, env.GEMINI_FALLBACK_MODEL);

export const simulatorTelephony = new SimulatorTelephony();

export const telephony: TelephonyProvider =
  env.TELEPHONY_PROVIDER === "telnyx"
    ? new TelnyxTelephony({
        apiKey: requireSetting("TELNYX_API_KEY", env.TELNYX_API_KEY, "Telnyx"),
        connectionId: requireSetting("TELNYX_CONNECTION_ID", env.TELNYX_CONNECTION_ID, "Telnyx"),
        messagingProfileId: env.TELNYX_MESSAGING_PROFILE_ID,
        ringbackUrl: `${env.PUBLIC_API_URL}/static/ringback.wav`,
      })
    : simulatorTelephony;

export const simulatorRegistry = new SimulatorRegistry();

/** Carrier registration (C-43) follows the texting provider: Telnyx texts need a Telnyx-filed registration. */
export const registry: CarrierRegistry =
  env.SMS_PROVIDER === "telnyx" ? new TelnyxRegistry(requireSetting("TELNYX_API_KEY", env.TELNYX_API_KEY, "Telnyx")) : simulatorRegistry;

export const consentLedger: ConsentLedger =
  env.CONSENT_LEDGER === "firestore"
    ? new FirestoreConsentLedger()
    : env.CONSENT_LEDGER === "local-and-firestore"
      ? new MirroredConsentLedger(new LocalConsentLedger(), new FirestoreConsentLedger())
      : new LocalConsentLedger();

/** Phone alerts (C-05): Firebase Cloud Messaging once a Firebase project is connected. */
export const push: PushProvider = env.FCM_ENABLED ? new FcmPush() : new SimulatedPush();

export const storage = new LocalBlobStorage(env.STORAGE_DIR);

/** Quote PDFs (C-45): headless Chrome or Edge renders the branded HTML. */
export const pdf: PdfRenderer = new ChromiumPdf(findBrowser(env.PDF_BROWSER_PATH));

export const simulatorPayments = new SimulatorPayments(resolve(process.cwd(), env.STORAGE_DIR, "simulator", "payments.json"), linkBaseUrl);

/**
 * Card payments (module 7). Stripe Connect is the named provider (test mode with an sk_test_
 * key); without a key the simulator plays its part with the same objects.
 */
export const payments: PaymentsProvider = env.STRIPE_SECRET_KEY
  ? new StripePayments(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET)
  : simulatorPayments;

export const simulatorCalendar = new SimulatorCalendar(resolve(process.cwd(), env.STORAGE_DIR, "simulator", "calendar.json"));

/**
 * Calendar sync (module 8), one adapter per provider a business can connect. Google Calendar
 * and Microsoft Outlook join in step 2 (both free); until then the simulator stands in.
 */
export const calendarProviders: Partial<Record<CalendarProvider["name"], CalendarProvider>> = { simulator: simulatorCalendar };

export const simulatorListings = new SimulatorListings(
  resolve(process.cwd(), env.STORAGE_DIR, "simulator", "google.json"),
  (account) => `${linkBaseUrl}/sim/google/${account}`,
);

/**
 * The business listing (module 9): Google Business Profile joins in step 2 (free, but Google
 * must approve API access and each business signs in); until then the simulator stands in.
 */
export const listingProviders: Partial<Record<ListingProvider["name"], ListingProvider>> = { simulator: simulatorListings };

export const simulatorWeather = new SimulatorWeather(resolve(process.cwd(), env.STORAGE_DIR, "simulator", "weather.json"));

/**
 * Seasonal offers (C-30) watch the forecast and the holiday calendar. The National Weather
 * Service and a holiday API (both free, no key) join in step 2; until then simulators stand in.
 */
export const weather: WeatherProvider = simulatorWeather;
export const holidays: HolidayProvider = new SimulatorHolidays();

/**
 * Message channels (module 5). WhatsApp is Meta's Cloud API once its keys are set; until then a
 * simulator stands in during development (C-11). The website chat is LeadAnchor's own (C-16).
 */
export const channels: { sms: ChannelAdapter; whatsapp: WhatsAppAdapter | null; email: ChannelAdapter; web: ChannelAdapter } = {
  email:
    env.EMAIL_TRANSPORT === "resend"
      ? new ResendEmail(requireSetting("RESEND_API_KEY", env.RESEND_API_KEY, "Resend"), env.EMAIL_TEST_RECIPIENT)
      : new OutboxEmail(),
  sms:
    env.SMS_PROVIDER === "telnyx"
      ? new TelnyxSms(requireSetting("TELNYX_API_KEY", env.TELNYX_API_KEY, "Telnyx"), env.TELNYX_MESSAGING_PROFILE_ID)
      : new SimulatorSms(),
  whatsapp:
    env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
      ? new MetaWhatsApp(env.WHATSAPP_ACCESS_TOKEN, env.WHATSAPP_PHONE_NUMBER_ID)
      : env.NODE_ENV === "production"
        ? null
        : new SimulatorWhatsApp(linkBaseUrl),
  web: new WebChat(),
};

function requireSetting(name: string, value: string | undefined, provider: string): string {
  if (!value) throw new Error(`${name} must be set when the ${provider} provider is selected.`);
  return value;
}
