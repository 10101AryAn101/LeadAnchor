import { getMessaging } from "firebase-admin/messaging";
import { logger } from "../../lib/logger";
import { firebaseApp } from "../firebase/app";
import type { PushMessage, PushProvider, PushResult } from "./types";

/** Error codes meaning a token will never work again. */
const DEAD_TOKEN = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);

/**
 * Firebase Cloud Messaging (named in the spec for C-05). High priority so the
 * "tap to call back" alert lands within seconds on Android and the installed web app.
 * The web app's service worker (public/sw.js) shows it and adds the Call back button.
 */
export class FcmPush implements PushProvider {
  readonly name = "fcm" as const;

  async send(message: PushMessage, tokens: string[]): Promise<PushResult> {
    try {
      const response = await getMessaging(firebaseApp()).sendEachForMulticast({
        tokens,
        notification: { title: message.title, body: message.body },
        data: { link: message.link, callbackPhone: message.callbackPhone ?? "", tag: message.tag ?? "" },
        android: { priority: "high" },
        apns: { headers: { "apns-priority": "10" } },
        webpush: { headers: { Urgency: "high" }, fcmOptions: { link: message.link } },
      });
      const invalidTokens = response.responses.flatMap((result, index) => (result.error && DEAD_TOKEN.has(result.error.code) ? [tokens[index]!] : []));
      return { status: response.successCount > 0 ? "fcm_sent" : "fcm_failed", invalidTokens };
    } catch (error) {
      logger.warn({ err: error }, "fcm push failed");
      return { status: "fcm_failed", invalidTokens: [] };
    }
  }
}
