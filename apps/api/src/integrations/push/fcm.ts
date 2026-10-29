import { getMessaging } from "firebase-admin/messaging";
import { logger } from "../../lib/logger";
import { firebaseApp } from "../firebase/app";
import type { PushMessage, PushProvider } from "./types";

/** Topic every device of a business subscribes to when the owner enables notifications. */
export const tenantTopic = (tenantId: string) => `tenant_${tenantId.replaceAll("-", "")}`;

/**
 * Firebase Cloud Messaging (named in the spec for C-05). High priority so the
 * "tap to call back" alert lands within seconds on Android and the installed web app.
 */
export class FcmPush implements PushProvider {
  readonly name = "fcm" as const;

  async send(message: PushMessage) {
    try {
      await getMessaging(firebaseApp()).send({
        topic: tenantTopic(message.tenantId),
        notification: { title: message.title, body: message.body },
        android: { priority: "high" },
        apns: { headers: { "apns-priority": "10" } },
        webpush: { headers: { Urgency: "high" }, fcmOptions: { link: message.link } },
      });
      return "fcm_sent" as const;
    } catch (error) {
      logger.warn({ err: error }, "fcm push failed");
      return "fcm_failed" as const;
    }
  }
}

/** Used until Firebase is configured: alerts appear in the app in real time only. */
export class InAppOnlyPush implements PushProvider {
  readonly name = "in_app" as const;
  async send() {
    return "in_app" as const;
  }
}
