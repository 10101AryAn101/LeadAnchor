import { resolve } from "node:path";
import { env, linkBaseUrl } from "./config/env";
import { GeminiProvider } from "./integrations/ai/gemini";
import type { AiProvider } from "./integrations/ai/types";
import { ChromiumPdf, type PdfRenderer, findBrowser } from "./integrations/documents/pdf";
import { FirestoreConsentLedger } from "./integrations/firebase/firestore-consent-ledger";
import { OutboxEmail } from "./integrations/messaging/email";
import { SimulatorSms, TelnyxSms } from "./integrations/messaging/sms";
import type { ChannelAdapter } from "./integrations/messaging/types";
import { MetaWhatsApp } from "./integrations/messaging/whatsapp";
import { SimulatorPayments } from "./integrations/payments/simulator";
import type { PaymentsProvider } from "./integrations/payments/types";
import { FcmPush } from "./integrations/push/fcm";
import { SimulatedPush } from "./integrations/push/simulator";
import type { PushProvider } from "./integrations/push/types";
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
        apiKey: requireSetting("TELNYX_API_KEY", env.TELNYX_API_KEY),
        connectionId: requireSetting("TELNYX_CONNECTION_ID", env.TELNYX_CONNECTION_ID),
        messagingProfileId: env.TELNYX_MESSAGING_PROFILE_ID,
        ringbackUrl: `${env.PUBLIC_API_URL}/static/ringback.wav`,
      })
    : simulatorTelephony;

export const simulatorRegistry = new SimulatorRegistry();

/** Carrier registration (C-43) follows the texting provider: Telnyx texts need a Telnyx-filed registration. */
export const registry: CarrierRegistry =
  env.SMS_PROVIDER === "telnyx" ? new TelnyxRegistry(requireSetting("TELNYX_API_KEY", env.TELNYX_API_KEY)) : simulatorRegistry;

export const consentLedger: ConsentLedger =
  env.CONSENT_LEDGER === "firestore" ? new FirestoreConsentLedger() : new LocalConsentLedger();

/** Phone alerts (C-05): Firebase Cloud Messaging once a Firebase project is connected. */
export const push: PushProvider = env.FCM_ENABLED ? new FcmPush() : new SimulatedPush();

export const storage = new LocalBlobStorage(env.STORAGE_DIR);

/** Quote PDFs (C-45): headless Chrome or Edge renders the branded HTML. */
export const pdf: PdfRenderer = new ChromiumPdf(findBrowser(env.PDF_BROWSER_PATH));

export const simulatorPayments = new SimulatorPayments(resolve(process.cwd(), env.STORAGE_DIR, "simulator", "payments.json"), linkBaseUrl);

/**
 * Card payments (module 7). Stripe Connect is the named provider; until a Stripe account is
 * connected (step 2, free test mode), the simulator plays its part with the same objects.
 */
export const payments: PaymentsProvider = simulatorPayments;

export const channels: { sms: ChannelAdapter; whatsapp: ChannelAdapter | null; email: ChannelAdapter } = {
  email: new OutboxEmail(),
  sms:
    env.SMS_PROVIDER === "telnyx"
      ? new TelnyxSms(requireSetting("TELNYX_API_KEY", env.TELNYX_API_KEY), env.TELNYX_MESSAGING_PROFILE_ID)
      : new SimulatorSms(),
  whatsapp:
    env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
      ? new MetaWhatsApp(env.WHATSAPP_ACCESS_TOKEN, env.WHATSAPP_PHONE_NUMBER_ID)
      : null,
};

function requireSetting(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} must be set when the Telnyx provider is selected.`);
  return value;
}
