import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env";
import { systemDb } from "../../db/client";
import { webhookInbox } from "../../db/schema";
import { HttpError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { serial } from "../../lib/serial";
import { payments, telephony } from "../../container";
import { verifyResendSignature } from "../../integrations/messaging/resend";
import { StripePayments } from "../../integrations/payments/stripe";
import { TelnyxTelephony, type TelnyxWebhook, verifyTelnyxSignature } from "../../integrations/telephony/telnyx";
import { callEngine } from "../../modules/calls";
import { applyEmailReport } from "../../modules/messaging/email-feedback";
import { handleInboundMessage, whatsappTestBusinessNumber } from "../../modules/messaging/inbound";
import { receivePaymentEvent } from "../../modules/payments/payment.service";

/**
 * Provider webhooks. Each delivery is verified, stored once in webhook_inbox
 * (duplicates become no-ops), acknowledged immediately, then processed in order per call.
 */
export async function webhookRoutes(app: FastifyInstance) {
  app.post("/api/webhooks/telnyx", async (req, reply) => {
    if (env.TELNYX_PUBLIC_KEY) {
      const valid = verifyTelnyxSignature({
        rawBody: req.rawBody ?? "",
        signature: header(req.headers["telnyx-signature-ed25519"]),
        timestamp: header(req.headers["telnyx-timestamp"]),
        publicKeyBase64: env.TELNYX_PUBLIC_KEY,
        toleranceSecs: env.TELNYX_WEBHOOK_TOLERANCE_SECS,
      });
      if (!valid) throw new HttpError(401, "invalid_signature", "Webhook signature check failed.");
    } else if (env.NODE_ENV === "production") {
      throw new HttpError(503, "not_configured", "TELNYX_PUBLIC_KEY is required in production.");
    }

    const webhook = req.body as TelnyxWebhook;
    const eventId = webhook?.data?.id;
    const eventType = webhook?.data?.event_type;
    if (!eventId || !eventType) return reply.status(400).send({ error: { code: "bad_payload", message: "Not a Telnyx event." } });

    const [stored] = await systemDb
      .insert(webhookInbox)
      .values({ provider: "telnyx", eventId, eventType, payload: webhook })
      .onConflictDoNothing()
      .returning({ id: webhookInbox.id });
    reply.status(200).send({ received: true });
    if (!stored) return; // duplicate delivery

    const key = String(webhook.data.payload?.call_session_id ?? webhook.data.payload?.id ?? eventId);
    void serial(key, () => processTelnyx(stored.id, webhook));
  });

  /**
   * Stripe (modules 7 and 12): events from the businesses' own accounts (Connect). The current
   * state is read from Stripe before answering, so if that fails Stripe delivers the event again.
   */
  app.post("/api/webhooks/stripe", async (req, reply) => {
    if (!(payments instanceof StripePayments)) throw new HttpError(503, "not_configured", "Stripe is not connected.");
    const event = (() => {
      try {
        return payments.verifyWebhook(req.rawBody ?? "", header(req.headers["stripe-signature"]));
      } catch {
        return null;
      }
    })();
    if (!event) throw new HttpError(400, "invalid_signature", "Webhook signature check failed.");
    for (const paymentEvent of await payments.eventsFrom(event)) {
      // A failure is kept in the webhook inbox; the next event about the same object catches up.
      await receivePaymentEvent(paymentEvent).catch((error) =>
        logger.error({ err: error, eventId: event.id }, "stripe event failed"),
      );
    }
    return reply.status(200).send({ received: true });
  });

  /** Resend: delivered, bounced and spam-complaint reports on the emails we sent (module 5). */
  app.post("/api/webhooks/resend", async (req, reply) => {
    if (!env.RESEND_WEBHOOK_SECRET) throw new HttpError(503, "not_configured", "Resend webhooks aren't set up.");
    const valid = verifyResendSignature({
      rawBody: req.rawBody ?? "",
      id: header(req.headers["svix-id"]),
      timestamp: header(req.headers["svix-timestamp"]),
      signature: header(req.headers["svix-signature"]),
      secret: env.RESEND_WEBHOOK_SECRET,
    });
    if (!valid) throw new HttpError(401, "invalid_signature", "Webhook signature check failed.");
    const event = req.body as { type?: string; data?: { email_id?: string } };
    const report =
      event.type === "email.delivered"
        ? "delivered"
        : event.type === "email.bounced"
          ? "bounce"
          : event.type === "email.complained"
            ? "complaint"
            : null;
    if (report && event.data?.email_id) await applyEmailReport(event.data.email_id, report);
    return reply.status(200).send({ received: true });
  });

  /** WhatsApp Cloud API: verification handshake (GET) and inbound messages (POST). */
  app.get("/api/webhooks/whatsapp", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    if (query["hub.mode"] === "subscribe" && env.WHATSAPP_VERIFY_TOKEN && query["hub.verify_token"] === env.WHATSAPP_VERIFY_TOKEN) {
      return reply.type("text/plain").send(query["hub.challenge"] ?? "");
    }
    return reply.status(403).send();
  });

  app.post("/api/webhooks/whatsapp", async (req, reply) => {
    if (!env.WHATSAPP_APP_SECRET) throw new HttpError(503, "not_configured", "WhatsApp is not connected.");
    const signature = header(req.headers["x-hub-signature-256"]);
    const expected = `sha256=${createHmac("sha256", env.WHATSAPP_APP_SECRET).update(req.rawBody ?? "").digest("hex")}`;
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new HttpError(401, "invalid_signature", "Webhook signature check failed.");
    }
    reply.status(200).send({ received: true });

    const body = req.body as WhatsAppWebhook;
    // Test mode: Meta's test number stands in for one business's own number.
    const testNumber = await whatsappTestBusinessNumber();
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const businessNumber = testNumber ?? change.value?.metadata?.display_phone_number;
        const profiles = new Map((change.value?.contacts ?? []).map((contact) => [contact.wa_id, contact.profile?.name ?? null]));
        for (const message of change.value?.messages ?? []) {
          if (message.type !== "text" || !businessNumber) continue;
          void handleInboundMessage({
            from: `+${message.from}`,
            to: `+${businessNumber.replace(/\D/g, "")}`,
            text: message.text?.body ?? "",
            channel: "whatsapp",
            provider: "meta",
            providerMessageId: message.id,
            profileName: profiles.get(message.from) ?? null,
          }).catch((error) => logger.error({ err: error }, "whatsapp inbound failed"));
        }
      }
    }
  });
}

async function processTelnyx(inboxId: string, webhook: TelnyxWebhook) {
  try {
    if (webhook.data.event_type === "message.received") {
      const p = webhook.data.payload as { from?: { phone_number?: string }; to?: Array<{ phone_number?: string }>; text?: string; id?: string };
      await handleInboundMessage({
        from: p.from?.phone_number ?? "",
        to: p.to?.[0]?.phone_number ?? "",
        text: p.text ?? "",
        channel: "sms",
        provider: "telnyx",
        providerMessageId: p.id ?? null,
      });
    } else if (telephony instanceof TelnyxTelephony) {
      for (const event of await telephony.ingest(webhook)) await callEngine.handle(event);
    }
    await systemDb.update(webhookInbox).set({ status: "processed", processedAt: new Date() }).where(eq(webhookInbox.id, inboxId));
  } catch (error) {
    logger.error({ err: error, eventType: webhook.data.event_type }, "telnyx webhook processing failed");
    await systemDb
      .update(webhookInbox)
      .set({ status: "failed", error: (error as Error).message.slice(0, 1000) })
      .where(eq(webhookInbox.id, inboxId));
  }
}

const header = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

interface WhatsAppWebhook {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { display_phone_number?: string };
        contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
        messages?: Array<{ id: string; from: string; type: string; text?: { body?: string } }>;
      };
    }>;
  }>;
}
