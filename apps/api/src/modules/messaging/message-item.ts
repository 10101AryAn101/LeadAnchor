import type { MessageItem } from "@leadanchor/contracts";
import type { messages } from "../../db/schema";
import { isoOrNow } from "../../lib/time";

export function toMessageItem(m: typeof messages.$inferSelect): MessageItem {
  return {
    id: m.id,
    direction: m.direction,
    channel: m.channel,
    purpose: m.purpose,
    status: m.status,
    subject: m.subject,
    body: m.body,
    blockedReason: m.blockedReason,
    provider: m.provider,
    createdAt: isoOrNow(m.createdAt),
  };
}
