import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { conversations, type customers, leads, messages, type tenants } from "../../db/schema";
import type { Effects } from "../../db/unit-of-work";
import { QUEUES } from "../../jobs/queue";
import { notifyOwner } from "../notifications/notify";
import { ON_CHANNEL, chatTitle } from "./chat.service";

type Tenant = typeof tenants.$inferSelect;
type Customer = typeof customers.$inferSelect;
type Conversation = typeof conversations.$inferSelect;

const OPEN_STAGES = ["new", "contacted", "quoted", "scheduled"] as const;
const excerpt = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Hands the customer's latest message to the assistant, or tells the owner it's waiting for them. */
export async function answerOrAlert(
  tx: Tx,
  fx: Effects,
  tenant: Tenant,
  conversation: Conversation,
  customer: Customer | null,
  text: string,
) {
  if (tenant.assistantEnabled && conversation.handler === "assistant" && !conversation.needsOwner) {
    await tx
      .update(conversations)
      .set({ assistantPendingAt: new Date() })
      .where(eq(conversations.id, conversation.id));
    // A short pause, so several quick messages get one reply.
    fx.enqueue(
      QUEUES.assistantReply,
      { tenantId: tenant.id, conversationId: conversation.id },
      { startAfterSecs: 2 },
    );
  } else {
    await notifyOwner(tx, fx, {
      tenantId: tenant.id,
      kind: "chat",
      title: `${chatTitle(conversation, customer)} wrote ${ON_CHANNEL[conversation.channel]}`,
      body: excerpt(text, 140),
      leadId: conversation.leadId,
      callbackPhone: conversation.contact ?? customer?.phoneE164 ?? null,
      path: `/chats?c=${conversation.id}`,
    });
  }
  fx.publish({ type: "chat.updated", conversationId: conversation.id });
}

/**
 * C-11, C-16: a WhatsApp message or a text joins the customer's chat on that channel (one per
 * number), which stays with their open job while there is one.
 */
export async function joinChat(
  tx: Tx,
  fx: Effects,
  input: {
    tenant: Tenant;
    customer: Customer;
    channel: "whatsapp" | "sms";
    contact: string;
    messageId: string;
    text: string;
  },
) {
  const { tenant, customer } = input;
  const now = new Date();
  const [existing] = await tx
    .select()
    .from(conversations)
    .where(and(eq(conversations.channel, input.channel), eq(conversations.contact, input.contact)))
    .limit(1);
  // A chat about a job that's finished starts fresh: the next job gets its own card.
  const [linked] = existing?.leadId
    ? await tx
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.id, existing.leadId), inArray(leads.stage, [...OPEN_STAGES])))
    : [];
  const [open] = linked
    ? [linked]
    : await tx
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.customerId, customer.id), inArray(leads.stage, [...OPEN_STAGES])))
        .limit(1);

  const values = {
    customerId: customer.id,
    leadId: open?.id ?? null,
    lastInboundAt: now,
    lastMessageAt: now,
  };
  const [conversation] = existing
    ? await tx
        .update(conversations)
        .set(values)
        .where(eq(conversations.id, existing.id))
        .returning()
    : await tx
        .insert(conversations)
        .values({ tenantId: tenant.id, channel: input.channel, contact: input.contact, ...values })
        .returning();
  await tx
    .update(messages)
    .set({ conversationId: conversation!.id, author: "customer", leadId: open?.id ?? null })
    .where(eq(messages.id, input.messageId));
  await answerOrAlert(tx, fx, tenant, conversation!, customer, input.text);
}
