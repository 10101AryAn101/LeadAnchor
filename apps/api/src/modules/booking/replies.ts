import { eq } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { bookings, type customers, waitlistOfferRecipients } from "../../db/schema";
import type { Effects } from "../../db/unit-of-work";
import { friendlyTime } from "../../lib/zoned";
import { addLeadEvent } from "../leads/lead-capture";
import { requestMessage } from "../messaging/send-path";
import { customerCancel, promptedBookings } from "./booking.service";
import { type Tenant, linkOf, lockBookings } from "./core";
import { claimOffer, openOffersFor } from "./waitlist.service";

type Customer = typeof customers.$inferSelect;

// Bare "CANCEL" never reaches here: carriers treat it as an opt-out, and so does the inbound handler.
const YES = /^\s*(y|yes|yep|yeah|yup|sure|ok|okay|confirm(ed)?|i'?ll take it|take it)\s*[.!]*\s*$/i;
const NO = /^\s*(n|no|nope|no thanks)\s*[.!]*\s*$/i;
const CANCEL = /\b(cancel|can'?t make it|cannot make it|won'?t make it|can'?t come|not coming)\b/i;
const RESCHEDULE =
  /\b(reschedule|another time|different time|change (the|my) (time|booking|appointment))\b/i;

export type ReplyIntent = "yes" | "no" | "cancel" | "reschedule" | null;

/** What a customer's text means for their booking, if anything. */
export function replyIntent(text: string): ReplyIntent {
  if (YES.test(text)) return "yes";
  if (NO.test(text)) return "no";
  if (RESCHEDULE.test(text)) return "reschedule";
  if (CANCEL.test(text)) return "cancel";
  return null;
}

/**
 * C-20 / C-22: answers to our texts. YES confirms a booking after its reminder, or takes a waitlist
 * offer, whichever we asked last; NO or "can't make it" cancels (freeing the slot for the waitlist);
 * "reschedule" gets the link to pick a new time. Returns false when the text isn't about a booking.
 */
export async function handleBookingReply(
  tx: Tx,
  fx: Effects,
  input: { tenant: Tenant; customer: Customer; text: string },
) {
  const intent = replyIntent(input.text);
  if (!intent) return false;
  const { tenant, customer } = input;

  const offers = (await openOffersFor(tx, customer.id))
    .filter((row) => row.recipient.textedAt && !row.recipient.declinedAt)
    .sort((a, b) => b.recipient.textedAt!.getTime() - a.recipient.textedAt!.getTime());
  const upcoming = await promptedBookings(tx, customer.id);
  const booking = upcoming.find((row) => row.reminderSentAt) ?? upcoming[0];
  const offer = offers[0];
  const bookingAskedAt = booking
    ? (booking.reminderSentAt ?? booking.confirmationSentAt ?? booking.createdAt)
    : null;
  const reply = (body: string, leadId: string | null) =>
    requestMessage(tx, fx, {
      tenant,
      customerId: customer.id,
      leadId,
      to: customer.phoneE164!,
      purpose: "conversational",
      body,
    });

  if (
    offer &&
    (intent === "yes" || intent === "no") &&
    (!bookingAskedAt || offer.recipient.textedAt! > bookingAskedAt)
  ) {
    if (intent === "no") {
      await tx
        .update(waitlistOfferRecipients)
        .set({ declinedAt: new Date() })
        .where(eq(waitlistOfferRecipients.id, offer.recipient.id));
      await reply("No problem, you're still on the waitlist.", null);
      return true;
    }
    // The booking confirmation goes out from the claim itself.
    if (!(await claimOffer(tenant.id, offer.recipient.id, { tx, fx })))
      await reply("Sorry, someone just took that time. You're still on the waitlist.", null);
    return true;
  }

  if (!booking) return false;
  const when = friendlyTime(booking.startsAt, tenant.timezone);
  if (intent === "yes") {
    if (!booking.confirmedAt) {
      await tx.update(bookings).set({ confirmedAt: new Date() }).where(eq(bookings.id, booking.id));
      await addLeadEvent(tx, {
        tenantId: tenant.id,
        leadId: booking.leadId,
        type: "booking.confirmed",
        actor: "customer",
        data: { bookingId: booking.id },
      });
      fx.publish({ type: "lead.updated", leadId: booking.leadId });
    }
    await reply(
      `Thanks, you're confirmed: ${booking.serviceName ?? "your visit"}, ${when}.`,
      booking.leadId,
    );
    return true;
  }
  if (intent === "reschedule") {
    const link = linkOf(booking);
    await reply(
      link
        ? `No problem. Pick a new time here: ${link}`
        : `No problem. ${tenant.name} will be in touch to find a new time.`,
      booking.leadId,
    );
    return true;
  }
  await lockBookings(tx, tenant.id);
  await customerCancel(tx, fx, booking, intent === "cancel" ? input.text.trim().slice(0, 300) : "");
  return true;
}
