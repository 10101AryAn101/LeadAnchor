import {
  type ChatChannel,
  LEAD_STAGE_LABELS,
  type LeadSource,
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  type WeekdayKey,
  formatPhone,
  toE164,
} from "@leadanchor/contracts";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { ai, consentLedger } from "../../container";
import { type Tx, withTenant } from "../../db/client";
import {
  carrierRegistrations,
  conversations,
  customers,
  leads,
  messages,
  phoneNumbers,
  services,
  tenants,
} from "../../db/schema";
import { type Effects, tenantWork } from "../../db/unit-of-work";
import type { ChatTurn } from "../../integrations/ai/types";
import { logger } from "../../lib/logger";
import { bookingUrl, settingsOf } from "../booking/core";
import { publicSlots } from "../booking/booking.service";
import { approvedForTexting } from "../compliance/registration.service";
import { upsertCustomerByPhone } from "../customers/customer.repo";
import { requestUrl } from "../intake/intake.service";
import { captureLead } from "../leads/lead-capture";
import { requestMessage } from "../messaging/send-path";
import { notifyOwner } from "../notifications/notify";
import { dollars } from "../payments/money";
import { ON_CHANNEL, addressOf, chatTitle, linkChatToLead } from "./chat.service";

type Tenant = typeof tenants.$inferSelect;
type Conversation = typeof conversations.$inferSelect;
type Service = typeof services.$inferSelect;

const NEW_CHAT: Record<ChatChannel, string> = {
  whatsapp: "New WhatsApp chat",
  web: "New website chat",
  sms: "New text conversation",
};

const SOURCE: Record<ChatChannel, LeadSource> = {
  whatsapp: "whatsapp",
  web: "web_chat",
  sms: "text",
};
const WEEK: WeekdayKey[] = [...WEEKDAY_KEYS.slice(1), "sun"];

const clock = (value: string) => {
  const [hour, minute] = value.split(":").map(Number) as [number, number];
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
};
const length = (mins: number | null) =>
  mins
    ? mins % 60 === 0
      ? `${mins / 60} hr`
      : mins > 60
        ? `${Math.floor(mins / 60)} hr ${mins % 60} min`
        : `${mins} min`
    : null;
const excerpt = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] ?? null;

/** "Hi Demo Plumbing, my sink…" → "My sink…": a greeting makes a poor job title. */
export function withoutGreeting(text: string, business: string) {
  const name = business.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const greeting = new RegExp(
    `^\\s*(hi|hello|hey|hiya|good (morning|afternoon|evening))\\b( there| team| all| guys| folks| ${name})?\\s*[,.!:-]*\\s*`,
    "i",
  );
  const rest = text.replace(greeting, "");
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : text;
}

/** The prices a reply may mention: the price list's, and any in the owner's own notes. */
export function pricesAllowed(reply: string, offered: Service[], notes: string | null) {
  const amounts = [...reply.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((match) =>
    Number(match[1]!.replace(/,/g, "")),
  );
  if (amounts.length === 0) return true;
  const listed = new Set(
    offered
      .filter((service) => service.priceCents !== null)
      .map((service) => service.priceCents! / 100),
  );
  for (const match of (notes ?? "").matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g))
    listed.add(Number(match[1]!.replace(/,/g, "")));
  return amounts.every((amount) => listed.has(amount));
}

async function textingAllowed(tx: Tx, tenantId: string, phone: string) {
  const [registration] = await tx
    .select({ status: carrierRegistrations.status, provider: carrierRegistrations.provider })
    .from(carrierRegistrations)
    .limit(1);
  if (!registration || !approvedForTexting(registration)) return false;
  return (
    (await consentLedger.latest(tenantId, phone, "sms_transactional", tx))?.action === "GRANTED"
  );
}

async function load(tenantId: string, conversationId: string) {
  return withTenant(tenantId, async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conversation) return null;
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [[number], offered, history, [customer]] = await Promise.all([
      tx
        .select({ e164: phoneNumbers.e164 })
        .from(phoneNumbers)
        .where(eq(phoneNumbers.status, "active"))
        .limit(1),
      tx.select().from(services).where(eq(services.active, true)).orderBy(asc(services.sortOrder)),
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), ne(messages.status, "blocked")))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(20),
      conversation.customerId
        ? tx.select().from(customers).where(eq(customers.id, conversation.customerId))
        : Promise.resolve([]),
    ]);
    const [openJob] = conversation.customerId
      ? await tx
          .select({ title: leads.title, stage: leads.stage })
          .from(leads)
          .where(
            and(
              eq(leads.customerId, conversation.customerId),
              inArray(leads.stage, ["contacted", "quoted", "scheduled"]),
            ),
          )
          .orderBy(desc(leads.lastActivityAt))
          .limit(1)
      : [];
    return {
      conversation,
      tenant: tenant!,
      number: number?.e164 ?? null,
      offered,
      history: history.reverse(),
      customer: customer ?? null,
      openJob: openJob
        ? `${openJob.title} (${LEAD_STAGE_LABELS[openJob.stage].toLowerCase()})`
        : null,
    };
  });
}

type Context = NonNullable<Awaited<ReturnType<typeof load>>>;

interface Plan {
  text: string;
  action: ChatTurn["action"];
  need: string | null;
  service: Service | null;
  urgency: ChatTurn["urgency"];
  customerName: string | null;
  phone: string | null;
  handoffReason: string | null;
}

/** When the AI can't answer: say hello and pass the chat to the owner, so nobody waits on nothing. */
function fallbackPlan(context: Context, link: string): Plan {
  const owner = firstName(context.tenant.ownerName) ?? "The owner";
  const answered = context.history.some((message) => message.direction === "outbound");
  const booking = settingsOf(context.tenant).enabled;
  const text = answered
    ? `Thanks! I've passed this to ${owner}, who'll reply here soon.`
    : `Hi! Thanks for messaging ${context.tenant.name}. I'm their automated assistant, and ${owner} will reply here soon. ${
        booking
          ? `If you'd like to book, you can pick a time here: ${link}`
          : `You can also send the details and photos here: ${link}`
      }`;
  return {
    text,
    action: "handoff",
    need: null,
    service: null,
    urgency: "normal",
    customerName: null,
    phone: null,
    handoffReason:
      "The assistant couldn't answer just now (the AI was busy), so it passed the chat to you.",
  };
}

/** The link that goes with a "book" answer: the booking page for the service, or the request form. */
async function bookingText(tenant: Tenant, service: Service | null) {
  if (!settingsOf(tenant).enabled) {
    return `\n\nSend the details and any photos here, and they'll set a time with you: ${requestUrl(tenant.slug)}?src=link`;
  }
  const link = `${bookingUrl(tenant.slug)}${service ? `?service=${service.id}` : ""}`;
  if (!service) return `\n\nPick a time here: ${link}`;
  try {
    const slots = await publicSlots(tenant.slug, service.id);
    // The first free time on each of the next few days, so they have a real choice.
    const next = slots.days.flatMap((day) => day.slots.slice(0, 1)).slice(0, 3);
    if (next.length === 0)
      return `\n\nThe next few weeks are full online. Join the waitlist or call them: ${link}`;
    const label = (iso: string) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: tenant.timezone,
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(iso));
    return `\n\nNext free times: ${next.map(label).join(", ")}. Pick one here: ${link}`;
  } catch (error) {
    logger.warn({ err: error, tenantId: tenant.id }, "couldn't list free times for the chat");
    return `\n\nPick a time here: ${link}`;
  }
}

/** C-16: the assistant answers the customer's latest message, on the chat's own channel. */
export async function assistantReplyJob(data: { tenantId: string; conversationId: string }) {
  const context = await load(data.tenantId, data.conversationId);
  if (!context) return;
  const { tenant, conversation, history, offered } = context;
  const last = history.at(-1);
  const clear = () =>
    withTenant(data.tenantId, (tx) =>
      tx
        .update(conversations)
        .set({ assistantPendingAt: null })
        .where(eq(conversations.id, conversation.id)),
    );
  // The owner is on it, or it's already answered (several quick messages share one reply).
  if (
    !tenant.assistantEnabled ||
    conversation.handler === "owner" ||
    conversation.needsOwner ||
    !last ||
    last.direction !== "inbound"
  ) {
    await clear();
    return;
  }
  // A text reply needs carrier approval and their consent; without them the owner calls instead.
  if (
    conversation.channel === "sms" &&
    !(await withTenant(data.tenantId, (tx) => textingAllowed(tx, tenant.id, conversation.contact!)))
  ) {
    await tenantWork(data.tenantId, (tx, fx) =>
      handOver(
        tx,
        fx,
        context,
        "They texted, but texting isn't allowed yet (carrier approval or their consent), so call them back.",
      ),
    );
    return;
  }

  const settings = settingsOf(tenant);
  const refs = new Map(offered.map((service, index) => [`s${index + 1}`, service]));
  let turn: ChatTurn | null = null;
  if (ai.configured) {
    try {
      turn = await ai.chatTurn({
        business: {
          name: tenant.name,
          trade: tenant.trade,
          area: [tenant.city, tenant.state].filter(Boolean).join(", ") || null,
          phone: context.number ? formatPhone(context.number) : null,
          hours: WEEK.map((day) =>
            settings.hours[day].open
              ? `${WEEKDAY_LABELS[day]} ${clock(settings.hours[day].start)}–${clock(settings.hours[day].end)}`
              : `${WEEKDAY_LABELS[day]} closed`,
          ),
          services: [...refs].map(([ref, service]) => ({
            ref,
            name: service.name,
            description: service.description,
            fromPrice: service.priceCents !== null ? dollars(service.priceCents) : null,
            length: length(service.durationMins),
          })),
          claims: [
            tenant.licenseNumber && tenant.insuranceCarrier
              ? "Licensed and insured"
              : tenant.licenseNumber
                ? "Licensed"
                : tenant.insuranceCarrier
                  ? "Insured"
                  : null,
            tenant.yearsInBusiness ? `${tenant.yearsInBusiness} years in business` : null,
          ].filter((claim): claim is string => claim !== null),
          canBookOnline: settings.enabled,
          notes: tenant.assistantNotes,
        },
        channel: conversation.channel,
        customer: {
          name: context.customer?.name ?? conversation.visitorName,
          hasPhone: Boolean(context.customer?.phoneE164 ?? conversation.contact),
          openJob: context.openJob,
        },
        history: history.map((message) => ({
          from: message.direction === "inbound" ? "customer" : "business",
          text: message.body,
        })),
        timeoutMs: 25_000,
      });
    } catch (error) {
      logger.warn(
        { err: error, conversationId: conversation.id },
        "assistant reply fell back to a handover",
      );
    }
  }

  let plan: Plan;
  if (turn && !pricesAllowed(turn.reply, offered, tenant.assistantNotes)) {
    // A price that isn't on the list never reaches the customer (prices come from the owner, C-45).
    logger.warn(
      { conversationId: conversation.id },
      "assistant mentioned a price that isn't listed",
    );
    plan = {
      ...fallbackPlan(context, ""),
      text: `Good question. I'll check that with ${firstName(tenant.ownerName) ?? "the owner"}, who'll reply here soon.`,
      handoffReason: "They asked about a price that isn't on your price list.",
    };
  } else if (turn) {
    const service = turn.serviceRef ? (refs.get(turn.serviceRef) ?? null) : null;
    plan = {
      text: turn.reply + (turn.action === "book" ? await bookingText(tenant, service) : ""),
      action: turn.action,
      need: turn.need,
      service,
      urgency: turn.urgency,
      customerName: turn.customerName,
      phone: turn.phone,
      handoffReason:
        turn.action === "handoff"
          ? (turn.handoffReason ?? "The assistant passed this chat to you.")
          : null,
    };
  } else {
    plan = fallbackPlan(
      context,
      settings.enabled ? bookingUrl(tenant.slug) : `${requestUrl(tenant.slug)}?src=link`,
    );
  }

  await tenantWork(data.tenantId, async (tx, fx) => {
    // Something else may have happened while the AI was thinking (the owner took over).
    const [now] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id))
      .for("update");
    if (!now || now.handler === "owner" || now.needsOwner) {
      await tx
        .update(conversations)
        .set({ assistantPendingAt: null })
        .where(eq(conversations.id, conversation.id));
      return;
    }
    const current = await recordWhatWeLearned(tx, fx, context, now, plan);
    const sent = await requestMessage(tx, fx, {
      tenant,
      customerId: current.customerId,
      leadId: current.leadId,
      to: addressOf(now),
      body: plan.text,
      purpose: "conversational",
      preferredChannels: [now.channel],
      conversationId: now.id,
      author: "assistant",
    });
    await tx
      .update(conversations)
      .set({
        assistantPendingAt: null,
        lastMessageAt: new Date(),
        ...(plan.service && { serviceId: plan.service.id }),
      })
      .where(eq(conversations.id, now.id));
    if (sent.status === "blocked")
      await handOver(
        tx,
        fx,
        { ...context, conversation: current },
        `The reply couldn't go: ${sent.blockedReason}`,
      );
    else if (plan.action === "handoff")
      await handOver(tx, fx, { ...context, conversation: current }, plan.handoffReason!);
    fx.publish({ type: "chat.updated", conversationId: now.id });
  });
}

/**
 * The job card: made once there's a need and a number to reach them (always on WhatsApp and
 * texts; on the website chat once they give one). Earlier messages are added to it.
 */
async function recordWhatWeLearned(
  tx: Tx,
  fx: Effects,
  context: Context,
  conversation: Conversation,
  plan: Plan,
) {
  const { tenant } = context;
  let current = conversation;
  const typed = plan.phone ? toE164(plan.phone) : null;
  const phone = conversation.contact ?? context.customer?.phoneE164 ?? typed;
  const name = plan.customerName ?? conversation.visitorName;
  if (name && !conversation.visitorName && !context.customer?.name) {
    await tx
      .update(conversations)
      .set({ visitorName: name })
      .where(eq(conversations.id, conversation.id));
  }
  if (!phone) return current;

  if (!current.customerId) {
    const customer = await upsertCustomerByPhone(tx, tenant.id, phone, { name });
    await tx
      .update(conversations)
      .set({ customerId: customer.id })
      .where(eq(conversations.id, conversation.id));
    current = { ...current, customerId: customer.id };
  }
  if (current.leadId || (!plan.need && plan.action !== "book" && plan.action !== "handoff"))
    return current;

  const firstMessage =
    context.history.find((message) => message.direction === "inbound")?.body ?? "";
  const title = excerpt(plan.need ?? withoutGreeting(firstMessage, tenant.name), 60) || "New chat";
  const { lead, created } = await captureLead(tx, fx, {
    tenant,
    phoneE164: phone,
    customerName: name,
    source: SOURCE[conversation.channel],
    title,
    summary: plan.need,
    needsCallback: plan.action === "handoff",
    event: {
      type: "chat.started",
      data: { channel: conversation.channel, text: excerpt(firstMessage, 280) },
    },
  });
  await tx
    .update(leads)
    .set({ urgency: plan.urgency, ...(plan.service && { serviceCategory: plan.service.name }) })
    .where(eq(leads.id, lead.id));
  await linkChatToLead(tx, conversation, lead.id, lead.customerId);
  current = { ...current, leadId: lead.id, customerId: lead.customerId };
  // A chat handed over at once gets the handover's priority alert instead.
  if (created && plan.action !== "handoff") {
    await notifyOwner(tx, fx, {
      tenantId: tenant.id,
      kind: "chat",
      title: `${NEW_CHAT[conversation.channel]}: ${title}`,
      body: `${name ?? formatPhone(phone)}: “${excerpt(firstMessage, 120)}” The assistant is replying.`,
      leadId: lead.id,
      callbackPhone: phone,
    });
  }
  return current;
}

/** The assistant steps back: the owner gets a priority alert with the reason. */
export async function handOver(
  tx: Tx,
  fx: Effects,
  context: Pick<Context, "tenant" | "conversation" | "customer">,
  reason: string,
) {
  const { tenant, conversation } = context;
  await tx
    .update(conversations)
    .set({ needsOwner: true, needsOwnerReason: reason, assistantPendingAt: null })
    .where(eq(conversations.id, conversation.id));
  const title = chatTitle(conversation, context.customer);
  await notifyOwner(tx, fx, {
    tenantId: tenant.id,
    kind: "chat",
    title: `${title} needs you ${ON_CHANNEL[conversation.channel]}`,
    body: reason,
    leadId: conversation.leadId,
    callbackPhone: conversation.contact ?? context.customer?.phoneE164 ?? null,
    path: `/chats?c=${conversation.id}`,
  });
  fx.publish({ type: "chat.updated", conversationId: conversation.id });
}
