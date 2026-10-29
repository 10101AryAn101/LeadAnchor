import type { ChannelAdapter, OutboundMessage } from "./types";

/**
 * WhatsApp Business Platform (Meta, mandated; reached through a BSP or directly).
 * Free-form replies are only allowed inside the 24-hour window the customer opens
 * by messaging first (C-11, C-31) — the send policy enforces that before this runs.
 */
export class MetaWhatsApp implements ChannelAdapter {
  readonly channel = "whatsapp" as const;
  readonly provider = "meta";

  constructor(
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
    private readonly graphVersion = "v23.0",
  ) {}

  async send(message: OutboundMessage) {
    const response = await fetch(`https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: message.to.replace(/^\+/, ""),
        type: "text",
        text: { body: message.body, preview_url: true },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string } };
    if (!response.ok) throw new Error(`WhatsApp send failed (${response.status}): ${json.error?.message ?? "unknown error"}`);
    return { providerMessageId: json.messages?.[0]?.id ?? null, delivered: false };
  }
}

/** Builds the wa.me deep link customers tap to start a chat (C-11). Works without any API account. */
export const whatsappDeepLink = (businessE164: string, prefill: string) =>
  `https://wa.me/${businessE164.replace(/^\+/, "")}?text=${encodeURIComponent(prefill)}`;
