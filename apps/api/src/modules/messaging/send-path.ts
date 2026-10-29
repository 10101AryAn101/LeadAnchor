import type { MessageChannel, MessagePurpose } from "@leadanchor/contracts";
import { and, desc, eq, gt } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { carrierRegistrations, messages, phoneNumbers, type tenants } from "../../db/schema";
import type { Effects } from "../../db/unit-of-work";
import { QUEUES } from "../../jobs/queue";
import { channels, consentLedger } from "../../container";
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
    .select({ status: carrierRegistrations.status })
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
    carrierApproved: registration?.status === "approved",
    whatsappWindowOpen: Boolean(recentInboundWhatsApp),
    whatsappConfigured: channels.whatsapp !== null,
    recipientLocalHour: localHour(intent.tenant.timezone),
  });

  const channel = decision.channel ?? intent.preferredChannels?.[0] ?? "sms";
  const provider = channel === "whatsapp" ? (channels.whatsapp?.provider ?? "meta") : channels.sms.provider;

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
    })
    .returning();

  if (decision.allowed) fx.enqueue(QUEUES.dispatchMessage, { tenantId: intent.tenant.id, messageId: message!.id });
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
