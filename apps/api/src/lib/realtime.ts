import { EventEmitter } from "node:events";

/**
 * In-process pub/sub that feeds the server-sent-events stream (/api/events).
 * One API process locally; when the API scales out this moves to Postgres
 * LISTEN/NOTIFY or Redis without changing callers.
 */
export type RealtimeEvent =
  | { type: "lead.created"; leadId: string }
  | { type: "lead.updated"; leadId: string }
  | { type: "call.updated"; callId: string }
  | { type: "notification.created"; notificationId: string; title: string; body: string; leadId: string | null }
  | { type: "message.created"; messageId: string; leadId: string | null }
  | { type: "registration.updated" }
  | { type: "settings.updated" }
  /** The business's payments account or Zelle/Venmo details changed (module 7). */
  | { type: "payments.updated" }
  /** Someone joined or left the waitlist, or an offer went out (C-22). */
  | { type: "waitlist.updated" }
  | { type: "reviews.updated" }
  | { type: "chat.updated"; conversationId: string }
  /** A member joined, paid, failed a payment, paused or cancelled (module 12). */
  | { type: "membership.updated"; membershipId: string }
  | { type: "quote.updated"; quoteId: string; leadId: string }
  /** The business's LeadAnchor tier, trial or billing changed. */
  | { type: "account.updated" }
  /** A job was offered to, taken from or passed by this business, or its network settings or referrals changed (C-24, C-25). */
  | { type: "network.updated" }
  /** The business's "Found by AI" check ran, or the owner switched it off or on (C-42). */
  | { type: "discovery.updated" }
  /** Simulated phone alert (C-05): shown by the browsers whose token is listed. */
  | {
      type: "push.preview";
      tokens: string[];
      title: string;
      body: string;
      link: string;
      callbackPhone: string | null;
      tag: string | null;
      sentAt: string;
    };

const bus = new EventEmitter();
bus.setMaxListeners(0);

export const realtime = {
  publish(tenantId: string, event: RealtimeEvent) {
    bus.emit(tenantId, event);
  },
  subscribe(tenantId: string, listener: (event: RealtimeEvent) => void) {
    bus.on(tenantId, listener);
    return () => bus.off(tenantId, listener);
  },
};
