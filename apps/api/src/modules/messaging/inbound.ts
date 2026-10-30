import type { MessageChannel } from "@leadanchor/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import { systemDb } from "../../db/client";
import { leads, messages, phoneNumbers, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { consentLedger } from "../../container";
import { handleBookingReply } from "../booking/replies";
import { joinChat } from "../chat/inbound-chat";
import { keywordReplies } from "../compliance/registration-copy";
import { upsertCustomerByPhone } from "../customers/customer.repo";
import { addLeadEvent } from "../leads/lead-capture";
import { requestMessage } from "./send-path";

/** Carrier-standard opt-out keywords (C-27: STOP → REVOKED within 10 business days; we do it instantly). */
const OPT_OUT = /^\s*(stop|stop\s*all|unsubscribe|cancel|end|quit|revoke|opt[\s-]?out)\s*[.!]*\s*$/i;
/** Carrier-standard opt back in. */
const OPT_IN = /^\s*(start|unstop)\s*[.!]*\s*$/i;
/** Carrier-standard help request. */
const HELP = /^\s*(help|info)\s*[.!?]*\s*$/i;

/**
 * Handles a message a customer sends to a business number. Opt-outs are written
 * to the consent ledger for SMS of every purpose before anything else happens.
 */
let testBusinessNumber: string | null = null;

/**
 * WhatsApp test mode: Meta's single test number answers for one business (WHATSAPP_TEST_BUSINESS),
 * so messages to it are treated as messages to that business's own number. Null when not set.
 */
export async function whatsappTestBusinessNumber(): Promise<string | null> {
  if (!env.WHATSAPP_TEST_BUSINESS) return null;
  if (testBusinessNumber) return testBusinessNumber;
  const [row] = await systemDb
    .select({ e164: phoneNumbers.e164 })
    .from(phoneNumbers)
    .innerJoin(tenants, eq(tenants.id, phoneNumbers.tenantId))
    .where(
      and(
        eq(tenants.slug, env.WHATSAPP_TEST_BUSINESS),
        eq(phoneNumbers.purpose, "tracking"),
        eq(phoneNumbers.status, "active"),
      ),
    )
    .limit(1);
  if (!row) logger.warn({ slug: env.WHATSAPP_TEST_BUSINESS }, "WHATSAPP_TEST_BUSINESS has no active number");
  testBusinessNumber = row?.e164 ?? null;
  return testBusinessNumber;
}

export async function handleInboundMessage(input: {
  from: string;
  to: string;
  text: string;
  channel: MessageChannel;
  provider: string;
  providerMessageId?: string | null;
  /** WhatsApp: the customer's profile name, used when we don't have their name yet. */
  profileName?: string | null;
}) {
  const [number] = await systemDb
    .select({ tenantId: phoneNumbers.tenantId })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.e164, input.to))
    .limit(1);
  if (!number) {
    logger.warn({ to: input.to }, "inbound message to an unknown number");
    return;
  }

  await tenantWork(number.tenantId, async (tx, fx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, number.tenantId));
    if (!tenant) return;
    const customer = await upsertCustomerByPhone(tx, tenant.id, input.from, { name: input.profileName?.trim() || null });
    const [openLead] = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.customerId, customer.id), inArray(leads.stage, ["new", "contacted", "quoted", "scheduled"])))
      .orderBy(desc(leads.lastActivityAt))
      .limit(1);

    const [message] = await tx
      .insert(messages)
      .values({
        tenantId: tenant.id,
        customerId: customer.id,
        leadId: openLead?.id ?? null,
        direction: "inbound",
        channel: input.channel,
        purpose: "conversational",
        status: "received",
        toAddress: input.to,
        fromAddress: input.from,
        body: input.text,
        provider: input.provider,
        providerMessageId: input.providerMessageId ?? null,
      })
      .returning({ id: messages.id });

    if (OPT_OUT.test(input.text)) {
      // C-27: STOP withdraws every texting and calling permission at once; START only restores job texts.
      for (const type of ["sms_transactional", "sms_marketing", "voice_marketing"] as const) {
        await consentLedger.record(
          {
            tenantId: tenant.id,
            phoneE164: input.from,
            type,
            action: "REVOKED",
            source: "stop_keyword",
            textVersion: "carrier-stop",
            evidence: `Customer texted "${input.text.trim()}"`,
            grantedTo: `${tenant.name} (${tenant.id})`,
          },
          tx,
        );
      }
      if (openLead) {
        await addLeadEvent(tx, { tenantId: tenant.id, leadId: openLead.id, type: "consent.revoked", actor: "customer", data: { keyword: input.text.trim() } });
      }
    } else if (OPT_IN.test(input.text)) {
      await consentLedger.record(
        {
          tenantId: tenant.id,
          phoneE164: input.from,
          type: "sms_transactional",
          action: "GRANTED",
          source: "inbound_message",
          textVersion: "carrier-start",
          evidence: `Customer texted "${input.text.trim()}"`,
          grantedTo: `${tenant.name} (${tenant.id})`,
        },
        tx,
      );
      if (openLead) {
        await addLeadEvent(tx, { tenantId: tenant.id, leadId: openLead.id, type: "consent.granted", actor: "customer", data: { channel: "sms", source: "inbound_message", answer: input.text.trim() } });
      }
    } else if (openLead) {
      await addLeadEvent(tx, { tenantId: tenant.id, leadId: openLead.id, type: "message.received", actor: "customer", data: { channel: input.channel, text: input.text } });
    }

    // Carriers require a reply to STOP, START and HELP, worded as in the business's campaign filing (C-43).
    const keyword = OPT_OUT.test(input.text) ? "optOut" : OPT_IN.test(input.text) ? "optIn" : HELP.test(input.text) ? "help" : null;
    // Anything else may answer a booking text: YES / NO after a reminder, or a waitlist offer (C-20, C-22).
    const handled = !keyword && input.channel !== "email" ? await handleBookingReply(tx, fx, { tenant, customer, text: input.text }) : false;
    // The rest is a conversation: the chat assistant answers it, or the owner does (C-11, C-16).
    if (!keyword && !handled && (input.channel === "whatsapp" || input.channel === "sms")) {
      await joinChat(tx, fx, { tenant, customer, channel: input.channel, contact: input.from, messageId: message!.id, text: input.text });
    }
    if (keyword) {
      await requestMessage(tx, fx, {
        tenant,
        customerId: customer.id,
        leadId: openLead?.id ?? null,
        to: input.from,
        body: keywordReplies(tenant.name)[keyword],
        purpose: "keyword_reply",
        preferredChannels: [input.channel],
      });
    }

    fx.publish({ type: "message.created", messageId: message!.id, leadId: openLead?.id ?? null });
    if (openLead) fx.publish({ type: "lead.updated", leadId: openLead.id });
  });
}
