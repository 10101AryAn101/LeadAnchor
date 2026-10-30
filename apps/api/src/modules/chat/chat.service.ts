import {
  type AssistantSettings,
  type ChatChannel,
  type ChatDetail,
  type ChatMessage,
  type ChatState,
  type ChatSummary,
  type ChatsResponse,
  WHATSAPP_WINDOW_HOURS,
  type assistantSettingsInput,
  formatPhone,
} from "@leadanchor/contracts";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import { channels, consentLedger } from "../../container";
import { type Tx, withTenant } from "../../db/client";
import {
  carrierRegistrations,
  conversations,
  customers,
  leads,
  messages,
  phoneNumbers,
  tenants,
} from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { HttpError, notFound } from "../../lib/errors";
import { audit } from "../compliance/audit";
import { approvedForTexting } from "../compliance/registration.service";
import { requestMessage } from "../messaging/send-path";
import { webChatUrl, whatsappLinkFor } from "./links";

type Conversation = typeof conversations.$inferSelect;
type Tenant = typeof tenants.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

const HOUR_MS = 3_600_000;

/** Where a reply goes: the customer's number, or the website chat itself. */
export const addressOf = (conversation: Pick<Conversation, "id" | "channel" | "contact">) =>
  conversation.channel === "web" ? `web:${conversation.id}` : conversation.contact!;

export function stateOf(conversation: Conversation, assistantEnabled: boolean): ChatState {
  if (conversation.needsOwner) return "needs_owner";
  return conversation.handler === "owner" || !assistantEnabled ? "owner" : "assistant";
}

/** The customer's name, their number, or "Website visitor". */
export const chatTitle = (
  conversation: Conversation,
  customer: { name: string | null; phoneE164: string | null } | null,
) =>
  customer?.name ??
  conversation.visitorName ??
  (customer?.phoneE164 ? formatPhone(customer.phoneE164) : null) ??
  (conversation.contact ? formatPhone(conversation.contact) : "Website visitor");

/** Alerts name the channel mid-sentence: "Maria needs you on WhatsApp". */
export const ON_CHANNEL: Record<ChatChannel, string> = {
  whatsapp: "on WhatsApp",
  web: "in the website chat",
  sms: "by text",
};

export function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    author: row.author ?? (row.direction === "inbound" ? "customer" : "owner"),
    text: row.body,
    at: row.createdAt.toISOString(),
    status: row.status,
    blockedReason: row.blockedReason,
  };
}

/** Connects a chat to a job once there is one, and gives its earlier messages to that job too. */
export async function linkChatToLead(
  tx: Tx,
  conversation: Pick<Conversation, "id">,
  leadId: string,
  customerId: string,
) {
  await tx
    .update(conversations)
    .set({ leadId, customerId })
    .where(eq(conversations.id, conversation.id));
  await tx
    .update(messages)
    .set({ leadId, customerId })
    .where(and(eq(messages.conversationId, conversation.id), isNull(messages.leadId)));
}

async function summaries(
  tx: Tx,
  rows: Conversation[],
  assistantEnabled: boolean,
): Promise<ChatSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [people, jobs, recent] = await Promise.all([
    tx
      .select({ id: customers.id, name: customers.name, phoneE164: customers.phoneE164 })
      .from(customers)
      .where(
        inArray(
          customers.id,
          rows.map((row) => row.customerId).filter((id): id is string => id !== null),
        ),
      ),
    tx
      .select({ id: leads.id, title: leads.title, stage: leads.stage })
      .from(leads)
      .where(
        inArray(
          leads.id,
          rows.map((row) => row.leadId).filter((id): id is string => id !== null),
        ),
      ),
    tx
      .select()
      .from(messages)
      .where(inArray(messages.conversationId, ids))
      .orderBy(desc(messages.createdAt), desc(messages.id)),
  ]);
  return rows.map((row) => {
    const customer = people.find((person) => person.id === row.customerId) ?? null;
    const lead = jobs.find((job) => job.id === row.leadId) ?? null;
    const last = recent.find((message) => message.conversationId === row.id) ?? null;
    return {
      id: row.id,
      channel: row.channel,
      state: stateOf(row, assistantEnabled),
      stateReason: row.needsOwner ? row.needsOwnerReason : null,
      title: chatTitle(row, customer),
      phone: customer?.phoneE164 ?? row.contact,
      lead,
      lastMessage: last
        ? {
            text: last.body,
            at: last.createdAt.toISOString(),
            author: last.author ?? (last.direction === "inbound" ? "customer" : "owner"),
          }
        : null,
      waiting: last !== null && last.direction === "inbound",
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function listChats(tenantId: string): Promise<ChatsResponse> {
  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const rows = await tx
      .select()
      .from(conversations)
      .orderBy(desc(conversations.lastMessageAt))
      .limit(60);
    return {
      chats: await summaries(tx, rows, tenant!.assistantEnabled),
      assistantOn: tenant!.assistantEnabled,
    };
  });
}

/** Can the owner reply right now, and is there a limit to know about? */
async function replyRules(
  tx: Tx,
  tenant: Tenant,
  conversation: Conversation,
): Promise<{ canReply: boolean; note: string | null }> {
  if (conversation.channel === "web")
    return {
      canReply: true,
      note: "They see your reply in the chat window, or the next time they open it.",
    };
  if (conversation.channel === "whatsapp") {
    if (!channels.whatsapp) return { canReply: false, note: "WhatsApp isn't connected." };
    const closes = conversation.lastInboundAt
      ? conversation.lastInboundAt.getTime() + WHATSAPP_WINDOW_HOURS * HOUR_MS
      : 0;
    if (closes <= Date.now()) {
      return {
        canReply: false,
        note: "WhatsApp only allows replies within 24 hours of their last message. Call them, or wait for them to write again.",
      };
    }
    const at = new Intl.DateTimeFormat("en-US", {
      timeZone: tenant.timezone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(closes);
    return { canReply: true, note: `You can reply on WhatsApp until ${at}.` };
  }
  const [registration] = await tx
    .select({ status: carrierRegistrations.status, provider: carrierRegistrations.provider })
    .from(carrierRegistrations)
    .limit(1);
  if (!registration || !approvedForTexting(registration))
    return { canReply: false, note: "Texting is blocked until carriers approve your business." };
  const consent = await consentLedger.latest(
    tenant.id,
    conversation.contact!,
    "sms_transactional",
    tx,
  );
  if (consent?.action !== "GRANTED")
    return { canReply: false, note: "They haven't agreed to texts. Call them instead." };
  return { canReply: true, note: null };
}

export async function getChat(tenantId: string, conversationId: string): Promise<ChatDetail> {
  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conversation) throw notFound("Chat");
    const [summary] = await summaries(tx, [conversation], tenant!.assistantEnabled);
    const rows = await tx
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(300);
    const rules = await replyRules(tx, tenant!, conversation);
    return {
      ...summary!,
      messages: rows.map(toChatMessage),
      canReply: rules.canReply,
      replyNote: rules.note,
      typing:
        conversation.assistantPendingAt !== null &&
        Date.now() - conversation.assistantPendingAt.getTime() < 90_000,
    };
  });
}

/** The owner writes in the chat. They're in it now, so the assistant steps back until handed the chat again. */
export async function ownerReply(
  tenantId: string,
  userId: string,
  conversationId: string,
  text: string,
): Promise<ChatDetail> {
  await tenantWork(tenantId, async (tx, fx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for("update");
    if (!conversation) throw notFound("Chat");
    const rules = await replyRules(tx, tenant!, conversation);
    if (!rules.canReply)
      throw new HttpError(
        409,
        "cannot_reply",
        rules.note ?? "You can't reply on this channel right now.",
      );
    const sent = await requestMessage(tx, fx, {
      tenant: tenant!,
      customerId: conversation.customerId,
      leadId: conversation.leadId,
      to: addressOf(conversation),
      body: text,
      purpose: "conversational",
      preferredChannels: [conversation.channel],
      conversationId,
      author: "owner",
    });
    await tx
      .update(conversations)
      .set({
        handler: "owner",
        needsOwner: false,
        needsOwnerReason: null,
        assistantPendingAt: null,
        lastMessageAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));
    if (sent.status === "blocked")
      throw new HttpError(409, "blocked", sent.blockedReason ?? "That message couldn't be sent.");
    fx.publish({ type: "chat.updated", conversationId });
    if (conversation.leadId) fx.publish({ type: "lead.updated", leadId: conversation.leadId });
  });
  return getChat(tenantId, conversationId);
}

/** Take a chat over from the assistant, or hand it back. */
export async function setHandler(
  tenantId: string,
  userId: string,
  conversationId: string,
  handler: "owner" | "assistant",
): Promise<ChatDetail> {
  await tenantWork(tenantId, async (tx, fx) => {
    const [row] = await tx
      .update(conversations)
      .set({
        handler,
        needsOwner: false,
        needsOwnerReason: null,
        ...(handler === "owner" && { assistantPendingAt: null }),
      })
      .where(eq(conversations.id, conversationId))
      .returning({ id: conversations.id });
    if (!row) throw notFound("Chat");
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: handler === "owner" ? "chat.taken_over" : "chat.handed_back",
      entityType: "conversation",
      entityId: conversationId,
    });
    fx.publish({ type: "chat.updated", conversationId });
  });
  return getChat(tenantId, conversationId);
}

export async function getAssistantSettings(tenantId: string): Promise<AssistantSettings> {
  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [number] = await tx
      .select({ e164: phoneNumbers.e164 })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.status, "active"))
      .limit(1);
    const [registration] = await tx
      .select({ status: carrierRegistrations.status, provider: carrierRegistrations.provider })
      .from(carrierRegistrations)
      .limit(1);
    return {
      enabled: tenant!.assistantEnabled,
      notes: tenant!.assistantNotes ?? "",
      whatsappLink: whatsappLinkFor(tenant!.name, number?.e164),
      whatsappNumber: channels.whatsapp ? (number?.e164 ?? null) : null,
      webChatUrl: webChatUrl(tenant!.slug),
      whatsappSimulated: channels.whatsapp?.provider === "simulator",
      textsAllowed: registration ? approvedForTexting(registration) : false,
    };
  });
}

export async function updateAssistantSettings(
  tenantId: string,
  userId: string,
  input: z.output<typeof assistantSettingsInput>,
) {
  await tenantWork(tenantId, async (tx, fx) => {
    await tx
      .update(tenants)
      .set({
        ...(input.enabled !== undefined && { assistantEnabled: input.enabled }),
        ...(input.notes !== undefined && { assistantNotes: input.notes || null }),
      })
      .where(eq(tenants.id, tenantId));
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "assistant.settings_updated",
      entityType: "tenant",
      entityId: tenantId,
      data: { enabled: input.enabled },
    });
    fx.publish({ type: "settings.updated" });
  });
  return getAssistantSettings(tenantId);
}
