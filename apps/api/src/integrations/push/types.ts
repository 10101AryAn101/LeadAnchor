import type { PushProviderName } from "@leadanchor/contracts";

export interface PushMessage {
  tenantId: string;
  title: string;
  body: string;
  /** Deep link opened when the owner taps the notification. */
  link: string;
  /** Missed calls and voicemails: the number behind the "Call back" button. */
  callbackPhone?: string | null;
  /** Alerts with the same tag replace each other on the phone (one per lead). */
  tag?: string;
}

export interface PushResult {
  status: "fcm_sent" | "fcm_failed" | "simulated";
  /** Tokens the push service no longer knows: alerts were turned off or the app removed. */
  invalidTokens: string[];
}

/** Push port (C-05: high-priority "tap to call back" alert). */
export interface PushProvider {
  readonly name: PushProviderName;
  send(message: PushMessage, tokens: string[]): Promise<PushResult>;
}
