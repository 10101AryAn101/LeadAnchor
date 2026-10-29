import type { MessageChannel } from "@leadanchor/contracts";

export interface OutboundMessage {
  id: string;
  from: string;
  to: string;
  /** Email only. */
  subject?: string | null;
  body: string;
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
