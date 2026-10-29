import { randomUUID } from "node:crypto";
import type { ChannelAdapter, OutboundMessage } from "./types";

/** Local SMS: the message is "delivered" to the simulated phone shown in the dev simulator. */
export class SimulatorSms implements ChannelAdapter {
  readonly channel = "sms" as const;
  readonly provider = "simulator";

  async send() {
    return { providerMessageId: `sim-msg-${randomUUID()}`, delivered: true };
  }
}

/** Telnyx Messaging API (mandated). Delivery receipts arrive later via the message.finalized webhook. */
export class TelnyxSms implements ChannelAdapter {
  readonly channel = "sms" as const;
  readonly provider = "telnyx";

  constructor(
    private readonly apiKey: string,
    private readonly messagingProfileId: string | undefined,
  ) {}

  async send(message: OutboundMessage) {
    const response = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        text: message.body,
        ...(this.messagingProfileId ? { messaging_profile_id: this.messagingProfileId } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json().catch(() => ({}))) as { data?: { id?: string }; errors?: Array<{ detail?: string }> };
    if (!response.ok) {
      throw new Error(`Telnyx SMS failed (${response.status}): ${json.errors?.[0]?.detail ?? "unknown error"}`);
    }
    return { providerMessageId: json.data?.id ?? null, delivered: false };
  }
}
