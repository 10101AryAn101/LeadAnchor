import { env } from "./config/env";
import { GeminiProvider } from "./integrations/ai/gemini";
import type { AiProvider } from "./integrations/ai/types";
import { FirestoreConsentLedger } from "./integrations/firebase/firestore-consent-ledger";
import { OutboxEmail } from "./integrations/messaging/email";
import { SimulatorSms, TelnyxSms } from "./integrations/messaging/sms";
import type { ChannelAdapter } from "./integrations/messaging/types";
import { MetaWhatsApp } from "./integrations/messaging/whatsapp";
import { FcmPush, InAppOnlyPush } from "./integrations/push/fcm";
import type { PushProvider } from "./integrations/push/types";
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

export const consentLedger: ConsentLedger =
  env.CONSENT_LEDGER === "firestore" ? new FirestoreConsentLedger() : new LocalConsentLedger();

export const push: PushProvider = env.FCM_ENABLED ? new FcmPush() : new InAppOnlyPush();

export const storage = new LocalBlobStorage(env.STORAGE_DIR);

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
