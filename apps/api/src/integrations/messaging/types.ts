import type { MessageChannel } from "@leadanchor/contracts";

export interface OutboundMessage {
  id: string;
  from: string;
  to: string;
  /** Email only. */
  subject?: string | null;
  body: string;
  /** Email only: the designed version, sent alongside the plain text. */
  html?: string | null;
  /** Email only. */
  replyTo?: string | null;
}

export interface SendResult {
  providerMessageId: string | null;
  /** Some adapters (the simulator) know delivery immediately. */
  delivered: boolean;
}

/** One channel adapter per provider. Only the dispatch job calls these — never feature code. */
export interface ChannelAdapter {
  readonly channel: MessageChannel;
  readonly provider: string;
  send(message: OutboundMessage): Promise<SendResult>;
}

/** WhatsApp also gives the business a link customers tap to start a chat (C-11). */
export interface WhatsAppAdapter extends ChannelAdapter {
  chatLink(businessE164: string, prefill: string): string;
}
