import type { MessageAuthor, MessageChannel, MessagePurpose } from "@leadanchor/contracts";
import { and, desc, eq, gt } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { carrierRegistrations, messages, phoneNumbers, type tenants } from "../../db/schema";
import type { Effects } from "../../db/unit-of-work";
import { env } from "../../config/env";
import { QUEUES } from "../../jobs/queue";
import { channels, consentLedger } from "../../container";
import { approvedForTexting } from "../compliance/registration.service";
import { MARKETING_EMAIL_PURPOSES, isOptedOut, marketingFooter, postalAddress, unsubscribeUrl } from "./email-opt-out";
import { decide } from "./policy";

type Tenant = typeof tenants.$inferSelect;

export interface MessageIntent {
  tenant: Tenant;
  customerId: string | null;
  leadId: string | null;
  to: string;
  body: string;
  purpose: MessagePurpose;
  preferredChannels?: MessageChannel[];
  /** Chats (C-11, C-16): the thread it belongs to, and who wrote it. */
  conversationId?: string | null;
  author?: MessageAuthor;
}

/**
 * The governed send path (Module 5). Feature code calls this — never a provider.
 * It gathers the facts, asks the policy, writes the message with the decision
 * attached (sent or blocked, and why), and queues delivery after commit.
 */
export async function requestMessage(tx: Tx, fx: Effects, intent: MessageIntent) {
  const [number] = await tx
    .select({ e164: phoneNumbers.e164 })
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.tenantId, intent.tenant.id), eq(phoneNumbers.status, "active")))
    .limit(1);

  const [registration] = await tx
    .select({ status: carrierRegistrations.status, provider: carrierRegistrations.provider })
    .from(carrierRegistrations)
    .where(eq(carrierRegistrations.tenantId, intent.tenant.id))
    .limit(1);

  const consent = await consentLedger.latest(intent.tenant.id, intent.to, "sms_transactional", tx);

  const [recentInboundWhatsApp] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, intent.tenant.id),
        eq(messages.channel, "whatsapp"),
        eq(messages.direction, "inbound"),
        eq(messages.fromAddress, intent.to),
        gt(messages.createdAt, new Date(Date.now() - 24 * 3600 * 1000)),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const decision = decide({
    purpose: intent.purpose,
    preferredChannels: intent.preferredChannels ?? ["sms", "whatsapp"],
    smsConsent: consent?.action ?? null,
    carrierApproved: registration ? approvedForTexting(registration) : false,
    whatsappWindowOpen: Boolean(recentInboundWhatsApp),
    whatsappConfigured: channels.whatsapp !== null,
    recipientLocalHour: localHour(intent.tenant.timezone),
    waitlistTextsCleared: env.WAITLIST_TEXTS_CLEARED,
    webChatOpen: intent.to.startsWith("web:"),
  });

  const channel = decision.channel ?? intent.preferredChannels?.[0] ?? "sms";
  const provider =
    channel === "whatsapp" ? (channels.whatsapp?.provider ?? "meta") : channel === "web" ? channels.web.provider : channels.sms.provider;

  const [message] = await tx
    .insert(messages)
    .values({
      tenantId: intent.tenant.id,
      customerId: intent.customerId,
      leadId: intent.leadId,
      direction: "outbound",
      channel,
      purpose: intent.purpose,
      status: decision.allowed ? "queued" : "blocked",
      toAddress: intent.to,
      fromAddress: number?.e164 ?? "unassigned",
      body: intent.body,
      blockedReason: decision.reason,
      provider,
      policy: { checks: decision.checks, consentRecordId: consent?.id ?? null },
      conversationId: intent.conversationId ?? null,
      author: intent.author ?? null,
    })
    .returning();

  if (decision.allowed) fx.enqueue(QUEUES.dispatchMessage, { tenantId: intent.tenant.id, messageId: message!.id });
  fx.publish({ type: "message.created", messageId: message!.id, leadId: intent.leadId });
  return message!;
}

export interface EmailIntent {
  tenant: Tenant;
  customerId: string | null;
  leadId: string | null;
  to: string;
  subject: string;
  body: string;
  purpose: MessagePurpose;
}

/**
 * Email goes through the same governed path as texts: one row per message with the
 * decision attached, delivered by the queue. Job and account emails need no opt-in.
 * Marketing-type email (review requests, later campaigns) skips anyone who unsubscribed
 * and carries the postal address and an unsubscribe link (CAN-SPAM).
 */
export async function requestEmail(tx: Tx, fx: Effects, intent: EmailIntent) {
  const validAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(intent.to);
  const checks = [{ check: "email_address", passed: validAddress, detail: validAddress ? "Address looks valid." : "Invalid address." }];
  let blockedReason = validAddress ? null : "That email address doesn't look right.";
  let body = intent.body;

  if (validAddress && MARKETING_EMAIL_PURPOSES.has(intent.purpose)) {
    const optedOut = await isOptedOut(tx, intent.to);
    checks.push({ check: "email_opt_out", passed: !optedOut, detail: optedOut ? "They unsubscribed from these emails." : "Not on the unsubscribe list." });
    const address = optedOut ? null : await postalAddress(tx, intent.tenant);
    if (!optedOut) checks.push({ check: "postal_address", passed: address !== null, detail: address ? "Postal address included." : "No postal address on file." });
    if (optedOut) blockedReason = "They unsubscribed from these emails.";
    else if (!address) blockedReason = "Add the business's street address and ZIP in Settings first (US anti-spam law).";
    else body += marketingFooter({ business: intent.tenant.name, address, unsubscribe: unsubscribeUrl(intent.tenant.id, intent.to) });
  }

  const [message] = await tx
    .insert(messages)
    .values({
      tenantId: intent.tenant.id,
      customerId: intent.customerId,
      leadId: intent.leadId,
      direction: "outbound",
      channel: "email",
      purpose: intent.purpose,
      status: blockedReason ? "blocked" : "queued",
      toAddress: intent.to,
      fromAddress: env.EMAIL_FROM,
      subject: intent.subject,
      body,
      blockedReason,
      provider: channels.email.provider,
      policy: { checks },
    })
    .returning();

  if (!blockedReason) fx.enqueue(QUEUES.dispatchMessage, { tenantId: intent.tenant.id, messageId: message!.id });
  fx.publish({ type: "message.created", messageId: message!.id, leadId: intent.leadId });
  return message!;
}

function localHour(timezone: string) {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone }).format(new Date())) % 24;
  } catch {
    return new Date().getHours();
  }
}
