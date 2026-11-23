import { createHmac, timingSafeEqual } from "node:crypto";
import { escapeHtml } from "../../lib/html";
import type { ChannelAdapter, OutboundMessage, SendResult } from "./types";

/** Resend's own test inboxes (delivered@, bounced@, complained@resend.dev) always go through. */
const RESEND_TEST_DOMAIN = "@resend.dev";

/**
 * Email through Resend (transactional and marketing email, with bounce and complaint reports).
 * Test mode: until a domain is verified, Resend only delivers to the account's own address, so
 * with EMAIL_TEST_RECIPIENT set every email goes there, marked with who it was really for.
 */
export class ResendEmail implements ChannelAdapter {
  readonly channel = "email" as const;
  readonly provider = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly testRecipient: string | undefined,
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    const redirected =
      this.testRecipient && !message.to.toLowerCase().endsWith(RESEND_TEST_DOMAIN)
        ? this.testRecipient
        : null;
    const note = redirected ? `Test mode: this email was for ${message.to}.` : null;
    const subject = message.subject ?? "";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        // A retried job never sends the same email twice.
        "Idempotency-Key": message.id,
      },
      body: JSON.stringify({
        from: message.from,
        to: [redirected ?? message.to],
        subject: redirected ? `[for ${message.to}] ${subject}` : subject,
        text: note ? `${note}\n\n${message.body}` : message.body,
        ...(message.html && {
          html: note
            ? `<p style="margin:0 0 16px;padding:8px 12px;background:#fff4d6;border-radius:6px;font:14px sans-serif">${escapeHtml(note)}</p>${message.html}`
            : message.html,
        }),
        ...(message.replyTo && { reply_to: message.replyTo }),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok)
      throw new Error(
        `Resend refused the email (${response.status}): ${data.message ?? response.statusText}`,
      );
    // Delivery is reported later, by webhook.
    return { providerMessageId: data.id ?? null, delivered: false };
  }
}

/**
 * Resend signs its webhooks the Svix way: HMAC-SHA256 over "id.timestamp.body" with the endpoint
 * secret (whsec_…, base64), sent as one or more "v1,<base64>" signatures.
 */
export function verifyResendSignature(input: {
  rawBody: string;
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  secret: string;
  toleranceSecs?: number;
  now?: number;
}): boolean {
  const { rawBody, id, timestamp, signature, secret } = input;
  if (!id || !timestamp || !signature) return false;
  const sentAt = Number(timestamp);
  const now = (input.now ?? Date.now()) / 1000;
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > (input.toleranceSecs ?? 300))
    return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = Buffer.from(
    createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64"),
  );
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
