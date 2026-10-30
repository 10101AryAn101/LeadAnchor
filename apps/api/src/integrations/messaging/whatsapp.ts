import { randomUUID } from "node:crypto";
import type { OutboundMessage, WhatsAppAdapter } from "./types";

/**
 * WhatsApp Business Platform (Meta, mandated; reached through a BSP or directly).
 * Free-form replies are only allowed inside the 24-hour window the customer opens
 * by messaging first (C-11, C-31) — the send policy enforces that before this runs.
 */
export class MetaWhatsApp implements WhatsAppAdapter {
  readonly channel = "whatsapp" as const;
  readonly provider = "meta";
  private readonly graphVersion: string;
  /** Test mode: Meta's one test number answers for a single business, so chat links lead to it. */
  private sharedNumber: string | null = null;

  constructor(
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
    options: { testMode?: boolean; graphVersion?: string } = {},
  ) {
    this.graphVersion = options.graphVersion ?? "v23.0";
    if (options.testMode)
      void this.ownNumber().then((number) => {
        this.sharedNumber = number;
      });
  }

  /** The number this WhatsApp account sends from (in test mode, Meta's test number), as +E.164. */
  async ownNumber(): Promise<string | null> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}?fields=display_phone_number`,
        { headers: { Authorization: `Bearer ${this.accessToken}` }, signal: AbortSignal.timeout(15_000) },
      );
      const json = (await response.json().catch(() => ({}))) as { display_phone_number?: string };
      const digits = json.display_phone_number?.replace(/\D/g, "");
      return response.ok && digits ? `+${digits}` : null;
    } catch {
      return null;
    }
  }

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

  chatLink(businessE164: string, prefill: string) {
    return whatsappDeepLink(this.sharedNumber ?? businessE164, prefill);
  }
}

/**
 * Local WhatsApp while Meta isn't connected: replies are "delivered" at once to the simulated
 * customer's WhatsApp (/sim/whatsapp/<business number>), where the chat link also leads.
 */
export class SimulatorWhatsApp implements WhatsAppAdapter {
  readonly channel = "whatsapp" as const;
  readonly provider = "simulator";

  constructor(private readonly pageBase: string) {}

  async send() {
    return { providerMessageId: `sim-wa-${randomUUID()}`, delivered: true };
  }

  chatLink(businessE164: string, prefill: string) {
    return `${this.pageBase}/sim/whatsapp/${businessE164.replace(/^\+/, "")}?text=${encodeURIComponent(prefill)}`;
  }
}

/** Builds the wa.me deep link customers tap to start a chat (C-11). Works without any API account. */
export const whatsappDeepLink = (businessE164: string, prefill: string) =>
  `https://wa.me/${businessE164.replace(/^\+/, "")}?text=${encodeURIComponent(prefill)}`;
