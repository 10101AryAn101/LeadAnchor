import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env";
import { systemDb } from "../../db/client";
import { webhookInbox } from "../../db/schema";
import { HttpError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { serial } from "../../lib/serial";
import { telephony } from "../../container";
import { TelnyxTelephony, type TelnyxWebhook, verifyTelnyxSignature } from "../../integrations/telephony/telnyx";
import { callEngine } from "../../modules/calls";
import { handleInboundMessage } from "../../modules/messaging/inbound";

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
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const businessNumber = change.value?.metadata?.display_phone_number;
        for (const message of change.value?.messages ?? []) {
          if (message.type !== "text" || !businessNumber) continue;
          void handleInboundMessage({
            from: `+${message.from}`,
            to: `+${businessNumber.replace(/\D/g, "")}`,
            text: message.text?.body ?? "",
            channel: "whatsapp",
            provider: "meta",
            providerMessageId: message.id,
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
        messages?: Array<{ id: string; from: string; type: string; text?: { body?: string } }>;
      };
    }>;
  }>;
}
