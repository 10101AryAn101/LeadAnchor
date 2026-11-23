import type { ChannelAdapter } from "./types";

/**
 * Development email transport. The message row the send path already wrote *is* the
 * outbox, so "sending" just marks it delivered; Dev → Email outbox shows what went out.
 * A real provider (SMTP or an email API) plugs in here without touching feature code.
 */
export class OutboxEmail implements ChannelAdapter {
  readonly channel = "email" as const;
  readonly provider = "outbox";

  async send() {
    return { providerMessageId: null, delivered: true };
  }
}
