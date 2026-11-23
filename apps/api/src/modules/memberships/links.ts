import { linkBaseUrl } from "../../config/env";
import { decryptSecret, encryptSecret } from "../../lib/crypto";

/** A plan's public sign-up page (C-48): the link the owner shares by text, WhatsApp or email. */
export const signupUrl = (linkToken: string) => `${linkBaseUrl}/m/${linkToken}`;

/** How long the "manage your plan" link in a receipt works (C-52 AC 4: it expires). */
const MANAGE_LINK_DAYS = 45;

/**
 * The member's own page, linked from every receipt: one membership only, sealed so it can't be
 * guessed or altered, and good for 45 days. Each new receipt carries a fresh one.
 */
export const manageUrl = (membershipId: string, now = Date.now()) =>
  `${linkBaseUrl}/m/manage/${encryptSecret(`${membershipId}\n${now + MANAGE_LINK_DAYS * 86_400_000}`)}`;

export function resolveManageToken(
  token: string,
): { membershipId: string; expired: boolean } | null {
  if (!/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
  try {
    const [membershipId, until] = decryptSecret(token).split("\n");
    if (!membershipId || !until) return null;
    return { membershipId, expired: Number(until) < Date.now() };
  } catch {
    return null;
  }
}
