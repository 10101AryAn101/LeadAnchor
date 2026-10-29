import { realtime } from "../../lib/realtime";
import type { PushMessage, PushProvider, PushResult } from "./types";

/**
 * Stands in for Firebase until it's connected. The alert travels over the app's live
 * connection and the browser's service worker shows it as a real notification, with the
 * same Call back button. Unlike Firebase it only reaches browsers with LeadAnchor open.
 */
export class SimulatedPush implements PushProvider {
  readonly name = "simulator" as const;

  async send(message: PushMessage, tokens: string[]): Promise<PushResult> {
    realtime.publish(message.tenantId, {
      type: "push.preview",
      tokens,
      title: message.title,
      body: message.body,
      link: message.link,
      callbackPhone: message.callbackPhone ?? null,
      tag: message.tag ?? null,
      sentAt: new Date().toISOString(),
    });
    return { status: "simulated", invalidTokens: [] };
  }
}
