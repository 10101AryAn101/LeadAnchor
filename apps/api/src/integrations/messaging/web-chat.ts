import { randomUUID } from "node:crypto";
import type { ChannelAdapter } from "./types";

/**
 * The website chat (C-10, C-16): LeadAnchor's own channel. A reply is delivered the moment it's
 * saved; the customer's chat page reads it from there.
 */
export class WebChat implements ChannelAdapter {
  readonly channel = "web" as const;
  readonly provider = "leadanchor";

  async send() {
    return { providerMessageId: `web-${randomUUID()}`, delivered: true };
  }
}
