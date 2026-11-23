/**
 * How a call reached the LeadAnchor number. It was either dialled straight to it (C-02), or the
 * owner missed it on their own cell and their phone company forwarded it on (C-01).
 */

/** The owner already let it ring on their own cell, so ringing them again would only make it ring twice. */
export function missedOnOwnerCell(call: { forwardedFrom?: string }, ownerCellE164: string | null): boolean {
  return Boolean(ownerCellE164 && call.forwardedFrom === ownerCellE164);
}

/** How long after a call starts its ring to the owner can still come back (that ring lasts at most 30 seconds). */
export const RING_ECHO_WINDOW_SECS = 120;

/**
 * Whether an incoming call is our own ring to the owner coming straight back, because their phone is
 * off or busy and forwards calls to the LeadAnchor number. Returns the call that is ringing the owner.
 *
 * We ring the owner showing the caller's number, so the echo usually carries it. Some carriers show the
 * owner's own number instead, with the Diversion header naming their cell. If the ring went out showing
 * the LeadAnchor number, the echo comes from the LeadAnchor number to itself.
 */
export function ringEchoOf<T extends { fromE164: string }>(
  call: { from: string; to: string; forwardedFrom?: string },
  ownerCellE164: string | null,
  ringingCalls: T[],
): T | null {
  if (!ownerCellE164) return null;
  const viaOwner = call.from === ownerCellE164 && call.forwardedFrom === ownerCellE164;
  const fromOurNumber = call.from === call.to;
  return ringingCalls.find((ringing) => ringing.fromE164 === call.from || viaOwner || fromOurNumber) ?? null;
}
