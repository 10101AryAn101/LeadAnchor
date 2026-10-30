import type { MessagePurpose } from "@leadanchor/contracts";
import { eq } from "drizzle-orm";
import { linkBaseUrl } from "../../config/env";
import type { Tx } from "../../db/client";
import { carrierRegistrations, emailOptOuts, type tenants } from "../../db/schema";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { escapeHtml } from "../../lib/html";

type Tenant = typeof tenants.$inferSelect;

/**
 * Marketing-type email (CAN-SPAM): review requests and campaigns (module 11). Each carries an
 * unsubscribe link and the business's postal address, and skips anyone who unsubscribed, marked
 * one as spam, or whose address bounced. Job emails (bookings, quotes, bills) are transactional.
 */
export const MARKETING_EMAIL_PURPOSES: ReadonlySet<MessagePurpose> = new Set([
  "marketing",
  "review_request",
]);

/** The unsubscribe link: the business and address, sealed, so the address never shows in the URL. */
export const unsubscribeUrl = (tenantId: string, email: string) =>
  `${linkBaseUrl}/u/${encryptSecret(`${tenantId}\n${email.trim().toLowerCase()}`)}`;

export function resolveUnsubscribeToken(token: string): { tenantId: string; email: string } | null {
  if (!/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
  try {
    const [tenantId, email] = decryptSecret(token).split("\n");
    return tenantId && email ? { tenantId, email } : null;
  } catch {
    return null;
  }
}

export async function isOptedOut(tx: Tx, email: string) {
  return (await suppressionOf(tx, email)) !== null;
}

/** Why an address gets no marketing email: "unsubscribe_link", "complaint" (marked as spam) or "bounce". */
export async function suppressionOf(tx: Tx, email: string) {
  const [row] = await tx
    .select({ source: emailOptOuts.source })
    .from(emailOptOuts)
    .where(eq(emailOptOuts.email, email.trim().toLowerCase()))
    .limit(1);
  return row?.source ?? null;
}

/** The owner-facing reason for a suppressed address. */
export const SUPPRESSION_REASONS: Record<string, string> = {
  unsubscribe_link: "They unsubscribed from these emails.",
  complaint: "They marked an earlier email as spam.",
  bounce: "Emails to this address bounce. Check it in the customer's details.",
};

interface Address {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

/**
 * The postal address CAN-SPAM requires in marketing email: the one in Settings, or the one given
 * for carrier registration. Null when neither is complete; such emails wait until it's added.
 */
export async function postalAddress(tx: Tx, tenant: Tenant): Promise<string | null> {
  const format = (address: Address) =>
    address.street && address.city && address.state && address.postalCode
      ? `${address.street}, ${address.city}, ${address.state} ${address.postalCode}`
      : null;
  const own = format({
    street: tenant.streetAddress ?? undefined,
    city: tenant.city ?? undefined,
    state: tenant.state ?? undefined,
    postalCode: tenant.postalCode ?? undefined,
  });
  if (own) return own;
  const [registration] = await tx
    .select({ details: carrierRegistrations.details })
    .from(carrierRegistrations)
    .limit(1);
  return format((registration?.details.address ?? {}) as Address);
}

export interface FooterInput {
  business: string;
  address: string;
  unsubscribe: string;
  /** Why they're getting it: "Demo Plumbing did work for you". */
  reason?: string;
  /** Campaigns say plainly that they're an offer (CAN-SPAM: identify it as an ad). */
  advertisement?: boolean;
}

const whyLine = (input: FooterInput) => {
  const reason = input.reason ?? `${input.business} did work for you`;
  return input.advertisement
    ? `This is an offer from ${input.business}. You're getting it because ${reason}.`
    : `You're getting this because ${reason}.`;
};

/** The footer of a marketing-type email: who it's from, where, and how to stop them. */
export const marketingFooter = (input: FooterInput) =>
  `\n\n—\n${whyLine(input)}\n${input.business}, ${input.address}\nTo stop these emails: ${input.unsubscribe}`;

/** The same footer for an email's designed (HTML) version. */
export const marketingFooterHtml = (input: FooterInput) =>
  `<p style="margin:0 0 6px">${escapeHtml(whyLine(input))}</p>` +
  `<p style="margin:0 0 6px">${escapeHtml(`${input.business}, ${input.address}`)}</p>` +
  `<p style="margin:0"><a href="${escapeHtml(input.unsubscribe)}" style="color:#5f6b68;text-decoration:underline">Unsubscribe</a></p>`;
