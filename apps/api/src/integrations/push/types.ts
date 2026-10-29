export interface PushMessage {
  tenantId: string;
  title: string;
  body: string;
  /** Deep link opened when the owner taps the notification. */
  link: string;
}

/** Push port (C-05: high-priority "tap to call back" alert). */
export interface PushProvider {
  readonly name: "fcm" | "in_app";
  send(message: PushMessage): Promise<"fcm_sent" | "fcm_failed" | "in_app">;
}
