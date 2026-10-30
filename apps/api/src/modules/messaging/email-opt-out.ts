import type { MessagePurpose } from "@leadanchor/contracts";
import { eq } from "drizzle-orm";
import { linkBaseUrl } from "../../config/env";
import type { Tx } from "../../db/client";
import { carrierRegistrations, emailOptOuts, type tenants } from "../../db/schema";
import { decryptSecret, encryptSecret } from "../../lib/crypto";

type Tenant = typeof tenants.$inferSelect;

/**
 * Marketing-type email (CAN-SPAM): review requests now, campaigns later (C-28). Each carries an
 * unsubscribe link and the business's postal address, and skips anyone who unsubscribed.
 * Job emails (bookings, quotes, bills) are transactional and don't.
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
  const [row] = await tx
    .select({ id: emailOptOuts.id })
    .from(emailOptOuts)
    .where(eq(emailOptOuts.email, email.trim().toLowerCase()))
    .limit(1);
  return Boolean(row);
}

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

/** The footer of a marketing-type email: who it's from, where, and how to stop them. */
export const marketingFooter = (input: {
  business: string;
  address: string;
  unsubscribe: string;
}) =>
  `\n\n—\nYou're getting this because ${input.business} did work for you.\n${input.business}, ${input.address}\nTo stop these emails: ${input.unsubscribe}`;
