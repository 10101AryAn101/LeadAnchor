import type { PublicChatContext, PublicChatThread, publicChatInput } from "@leadanchor/contracts";
import { and, asc, eq, ne } from "drizzle-orm";
import type { z } from "zod";
import { systemDb } from "../../db/client";
import { conversations, customers, messages, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { randomToken, sha256 } from "../../lib/crypto";
import { HttpError, notFound } from "../../lib/errors";
import { addLeadEvent } from "../leads/lead-capture";
import { publicBusinessOf } from "../payments/payment.service";
import { answerOrAlert } from "./inbound-chat";

const MESSAGES_PER_10_MIN = 20;
const recent = new Map<string, number[]>();

async function tenantBySlug(slug: string) {
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!tenant || tenant.status === "cancelled" || tenant.status === "suspended")
    throw notFound("Business");
  return tenant;
}

const validToken = (token: string | undefined | null) =>
  typeof token === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(token);

export async function getChatContext(slug: string): Promise<PublicChatContext> {
  const tenant = await tenantBySlug(slug);
  const owner = tenant.ownerName?.trim().split(/\s+/)[0];
  return {
    business: await publicBusinessOf(tenant),
    greeting: tenant.assistantEnabled
      ? `Hi! I'm ${tenant.name}'s assistant. What can we help you with today?`
      : `Hi! Send ${tenant.name} a message and ${owner ?? "the owner"} will reply here.`,
  };
}

async function thread(conversationId: string): Promise<Omit<PublicChatThread, "token">> {
  const [conversation] = await systemDb
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  const rows = await systemDb
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), ne(messages.status, "blocked")))
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(200);
  return {
    messages: rows.map((row) => ({
      id: row.id,
      from: row.direction === "inbound" ? ("customer" as const) : ("business" as const),
      text: row.body,
      at: row.createdAt.toISOString(),
    })),
    typing:
      conversation?.assistantPendingAt != null &&
      Date.now() - conversation.assistantPendingAt.getTime() < 90_000,
  };
}

async function resolve(tenantId: string, token: string) {
  const [conversation] = await systemDb
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tokenHash, sha256(token)),
        eq(conversations.tenantId, tenantId),
        eq(conversations.channel, "web"),
      ),
    )
    .limit(1);
  if (!conversation)
    throw new HttpError(404, "chat_not_found", "That chat has ended. Start a new one.");
  return conversation;
}

export async function getChatThread(
  slug: string,
  token: string | undefined,
): Promise<PublicChatThread> {
  if (!validToken(token))
    throw new HttpError(404, "chat_not_found", "That chat has ended. Start a new one.");
  const tenant = await tenantBySlug(slug);
  const conversation = await resolve(tenant.id, token!);
  return { token: null, ...(await thread(conversation.id)) };
}

/** C-10, C-16: the visitor writes in the website chat. The first message starts the chat and its token. */
export async function postChatMessage(
  slug: string,
  token: string | undefined,
  input: z.output<typeof publicChatInput>,
  meta: { ipAddress: string | null },
): Promise<PublicChatThread> {
  const tenant = await tenantBySlug(slug);
  if (input.company) return { token: null, messages: [], typing: false };
  const key = `${tenant.id}:${meta.ipAddress ?? "unknown"}`;
  const times = (recent.get(key) ?? []).filter((at) => Date.now() - at < 600_000);
  if (times.length >= MESSAGES_PER_10_MIN)
    throw new HttpError(429, "too_many_requests", `Please call ${tenant.name} instead.`);
  if (recent.size > 10_000) recent.clear();
  recent.set(key, [...times, Date.now()]);

  const existing = validToken(token) ? await resolve(tenant.id, token!) : null;
  const fresh = existing ? null : randomToken();
  const conversationId = await tenantWork(tenant.id, async (tx, fx) => {
    const now = new Date();
    const [conversation] = existing
      ? await tx
          .update(conversations)
          .set({ lastInboundAt: now, lastMessageAt: now })
          .where(eq(conversations.id, existing.id))
          .returning()
      : await tx
          .insert(conversations)
          .values({
            tenantId: tenant.id,
            channel: "web",
            tokenHash: sha256(fresh!),
            source: input.source,
            lastInboundAt: now,
            lastMessageAt: now,
          })
          .returning();
    await tx.insert(messages).values({
      tenantId: tenant.id,
      customerId: conversation!.customerId,
      leadId: conversation!.leadId,
      direction: "inbound",
      channel: "web",
      purpose: "conversational",
      status: "received",
      toAddress: tenant.slug,
      fromAddress: `web:${conversation!.id}`,
      body: input.text,
      provider: "leadanchor",
      conversationId: conversation!.id,
      author: "customer",
    });
    const [customer] = conversation!.customerId
      ? await tx.select().from(customers).where(eq(customers.id, conversation!.customerId))
      : [];
    if (conversation!.leadId) {
      // Later messages show on the job, as WhatsApp messages and texts do.
      await addLeadEvent(tx, {
        tenantId: tenant.id,
        leadId: conversation!.leadId,
        type: "message.received",
        actor: "customer",
        data: { channel: "web", text: input.text },
      });
    }
    await answerOrAlert(tx, fx, tenant, conversation!, customer ?? null, input.text);
    if (conversation!.leadId) fx.publish({ type: "lead.updated", leadId: conversation!.leadId });
    return conversation!.id;
  });
  return { token: fresh, ...(await thread(conversationId)) };
}
