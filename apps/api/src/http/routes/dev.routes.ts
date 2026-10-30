import {
  type OutboxEmail,
  type SimCheckout,
  type SimOnboarding,
  type SimGoogleListing,
  type SimRedirect,
  simCalendarEventInput,
  simGoogleReviewInput,
  simCheckoutInput,
  simOnboardingInput,
  simulatorScenarioInput,
  toE164,
  usPhone,
} from "@leadanchor/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { systemDb, withTenant } from "../../db/client";
import { listingConnections, messages, phoneNumbers } from "../../db/schema";
import { HttpError, badRequest, notFound, parseInput } from "../../lib/errors";
import { payments, simulatorListings, simulatorPayments, simulatorTelephony, telephony } from "../../container";
import { PaymentRefused } from "../../integrations/payments/types";
import { getCallTrace } from "../../modules/calls/call.queries";
import { approveRegistrationForDev, resetRegistrationForDev, simulatedRegistrationCode } from "../../modules/compliance/registration.service";
import { handleInboundMessage } from "../../modules/messaging/inbound";
import { paymentsTickJob, receivePaymentEvent } from "../../modules/payments/payment.service";
import { bookingsTickJob, sendReminder } from "../../modules/booking/booking.service";
import { addSimulatedEvent, moveSimulatedEvent, removeSimulatedEvent, simulatedCalendarEvents } from "../../modules/booking/calendar-sync";
import { paymentRequests } from "../../db/schema";
import { sendValueProof } from "../../modules/value-proof/value-proof";
import { hoursList, syncListing } from "../../modules/reviews/listing.service";
import { sendWaitingRequestsNow } from "../../modules/reviews/review-requests";
import { tenantContext } from "../context";

/** Development-only tools: the call simulator, the simulated customer phone and fake carrier approval. */
export async function devRoutes(app: FastifyInstance) {
  async function trackingNumber(tenantId: string) {
    const [number] = await withTenant(tenantId, (tx) =>
      tx.select({ e164: phoneNumbers.e164 }).from(phoneNumbers).where(eq(phoneNumbers.status, "active")).limit(1),
    );
    if (!number) throw badRequest("This business has no phone number yet.");
    return number.e164;
  }

  app.post("/api/dev/simulator/calls", async (req, reply) => {
    const ctx = await tenantContext(req);
    if (telephony.name !== "simulator") throw new HttpError(409, "not_simulated", "The simulator is off because Telnyx is connected.");
    const scenario = parseInput(simulatorScenarioInput, req.body);
    const handle = simulatorTelephony.startCall(await trackingNumber(ctx.tenantId), scenario);
    return reply.status(202).send({ sessionId: handle.sessionId });
  });

  app.get("/api/dev/simulator/calls/:sessionId", async (req) => {
    const ctx = await tenantContext(req);
    const { sessionId } = parseInput(z.object({ sessionId: z.string().min(5) }), req.params);
    return getCallTrace(ctx.tenantId, { sessionId });
  });

  /** What the customer's phone would show: texts sent to that number by this business. */
  app.get("/api/dev/simulator/inbox", async (req) => {
    const ctx = await tenantContext(req);
    const { phone } = parseInput(z.object({ phone: usPhone }), req.query);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx
        .select()
        .from(messages)
        .where(and(inArray(messages.status, ["sent", "delivered", "received"]), eq(messages.toAddress, phone)))
        .orderBy(desc(messages.createdAt))
        .limit(30),
    );
    const replies = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(messages).where(and(eq(messages.direction, "inbound"), eq(messages.fromAddress, phone))).orderBy(desc(messages.createdAt)).limit(30),
    );
    return {
      messages: [...rows, ...replies]
        // A reply sent while handling a text shares its timestamp; ids are time-ordered.
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .map((m) => ({ id: m.id, direction: m.direction, body: m.body, channel: m.channel, status: m.status, createdAt: m.createdAt.toISOString() })),
    };
  });

  /** The simulated customer texts the business back (e.g. "STOP"). */
  app.post("/api/dev/simulator/reply", async (req, reply) => {
    const ctx = await tenantContext(req);
    const { from, text } = parseInput(z.object({ from: z.string(), text: z.string().trim().min(1).max(500) }), req.body);
    const phone = toE164(from);
    if (!phone) throw badRequest("Enter a valid phone number.");
    await handleInboundMessage({ from: phone, to: await trackingNumber(ctx.tenantId), text, channel: "sms", provider: "simulator" });
    return reply.status(201).send({ ok: true });
  });

  app.post("/api/dev/simulator/registration/approve", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return approveRegistrationForDev(ctx.tenantId, ctx.userId);
  });

  app.post("/api/dev/simulator/registration/reset", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return resetRegistrationForDev(ctx.tenantId, ctx.userId);
  });

  /** The code the pretend carriers "texted" a sole proprietor. */
  app.get("/api/dev/simulator/registration/code", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return { code: await simulatedRegistrationCode(ctx.tenantId) };
  });

  /** Emails the app has "sent" while no email service is connected (Dev → Email outbox). */
  app.get("/api/dev/outbox", async (req): Promise<{ emails: OutboxEmail[] }> => {
    const ctx = await tenantContext(req);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(messages).where(eq(messages.channel, "email")).orderBy(desc(messages.createdAt)).limit(50),
    );
    return {
      emails: rows.map((m) => ({
        id: m.id,
        to: m.toAddress,
        subject: m.subject,
        body: m.body,
        status: m.status,
        blockedReason: m.blockedReason,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });

  /* ── Simulated Stripe (module 7): its hosted pages, and the events its webhook would send ── */

  const simulatedOnly = () => {
    if (payments.name !== "simulator") throw new HttpError(409, "not_simulated", "Payments go through Stripe, so the simulator is off.");
  };
  const checkoutParam = z.object({ id: z.string().regex(/^cs_sim_[a-f0-9]+$/) });
  const accountParam = z.object({ id: z.string().regex(/^acct_sim_[a-f0-9]+$/) });

  /** The simulated hosted checkout page. Public, like Stripe's own page: the customer opens it. */
  app.get("/api/dev/simulator/stripe/checkout/:id", async (req): Promise<SimCheckout> => {
    simulatedOnly();
    const { id } = parseInput(checkoutParam, req.params);
    const view = simulatorPayments.checkoutView(id);
    if (!view) throw notFound("Checkout");
    return view;
  });

  app.post("/api/dev/simulator/stripe/checkout/:id", async (req): Promise<SimRedirect | SimCheckout> => {
    simulatedOnly();
    const { id } = parseInput(checkoutParam, req.params);
    const { outcome } = parseInput(simCheckoutInput, req.body);
    try {
      const { redirectUrl, event } = simulatorPayments.completeCheckout(id, outcome);
      // What Stripe's webhook would deliver, handled exactly like the real one.
      if (event) await receivePaymentEvent(event);
      return redirectUrl ? { redirectUrl } : simulatorPayments.checkoutView(id)!;
    } catch (error) {
      if (error instanceof PaymentRefused) throw new HttpError(409, "payment_refused", error.message);
      throw error;
    }
  });

  app.get("/api/dev/simulator/stripe/onboarding/:id", async (req): Promise<SimOnboarding> => {
    simulatedOnly();
    const { id } = parseInput(accountParam, req.params);
    const view = simulatorPayments.onboardingView(id);
    if (!view) throw notFound("Account");
    return view;
  });

  app.post("/api/dev/simulator/stripe/onboarding/:id", async (req): Promise<SimRedirect> => {
    simulatedOnly();
    const { id } = parseInput(accountParam, req.params);
    const { outcome } = parseInput(simOnboardingInput, req.body);
    const { redirectUrl, event } = simulatorPayments.completeOnboarding(id, outcome);
    if (event) await receivePaymentEvent(event);
    return { redirectUrl };
  });

  /** Runs the 15-minute payments check now: reconciliation and hold reminders. */
  app.post("/api/dev/simulator/payments/tick", async (req) => {
    await tenantContext(req, ["owner"]);
    await paymentsTickJob();
    return { ok: true };
  });

  /** Moves a deposit hold's end date close, to try the "hold ends soon" alert without waiting a week. */
  app.post("/api/dev/simulator/payments/:id/age", async (req) => {
    simulatedOnly();
    const ctx = await tenantContext(req, ["owner"]);
    const { id } = parseInput(z.object({ id: z.uuid() }), req.params);
    const { hoursLeft } = parseInput(z.object({ hoursLeft: z.number().min(-48).max(24 * 7) }), req.body);
    const [row] = await withTenant(ctx.tenantId, (tx) => tx.select().from(paymentRequests).where(eq(paymentRequests.id, id)));
    if (!row?.providerPaymentId || row.status !== "held") throw badRequest("Only a deposit on hold can be moved forward.");
    simulatorPayments.ageHold(row.providerPaymentId, hoursLeft);
    await withTenant(ctx.tenantId, (tx) =>
      tx.update(paymentRequests).set({ holdExpiresAt: new Date(Date.now() + hoursLeft * 3600_000), holdWarnedAt: null }).where(eq(paymentRequests.id, id)),
    );
    return { ok: true };
  });

  /* ── Simulated calendar (module 8): edits as if the owner made them in Google Calendar ── */

  app.get("/api/dev/simulator/calendar", async (req) => {
    const ctx = await tenantContext(req);
    return { events: await simulatedCalendarEvents(ctx.tenantId) };
  });

  app.post("/api/dev/simulator/calendar", async (req, reply) => {
    const ctx = await tenantContext(req);
    await addSimulatedEvent(ctx.tenantId, parseInput(simCalendarEventInput, req.body));
    return reply.status(201).send({ events: await simulatedCalendarEvents(ctx.tenantId) });
  });

  app.patch("/api/dev/simulator/calendar/:id", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(z.object({ id: z.string().regex(/^evt_sim_[a-f0-9]+$/) }), req.params);
    await moveSimulatedEvent(ctx.tenantId, id, parseInput(simCalendarEventInput.pick({ startsAt: true, endsAt: true }), req.body));
    return { events: await simulatedCalendarEvents(ctx.tenantId) };
  });

  app.delete("/api/dev/simulator/calendar/:id", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(z.object({ id: z.string().regex(/^evt_sim_[a-f0-9]+$/) }), req.params);
    await removeSimulatedEvent(ctx.tenantId, id);
    return { events: await simulatedCalendarEvents(ctx.tenantId) };
  });

  /* ── Simulated Google listing: the business's page, where customers leave reviews (C-21) ── */

  const googleAccount = z.object({ account: z.string().regex(/^sim-[0-9a-f-]{36}$/) });

  const simGoogle = (account: string): SimGoogleListing => {
    const listing = simulatorListings.view(account);
    if (!listing) throw notFound("Listing");
    const reviews = Object.values(listing.reviews).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const ratings = reviews.map((review) => review.rating);
    return {
      account,
      name: listing.name,
      rating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
      reviewCount: ratings.length,
      phone: listing.details.phone,
      website: listing.details.website,
      bookingLink: listing.details.bookingLink,
      hours: listing.details.hours ? hoursList(listing.details.hours) : [],
      reviews,
      posts: listing.posts,
      failNextReply: listing.failNextReply,
    };
  };

  /** The business whose listing this is, so a new review is read in straight away. */
  const syncOwner = async (account: string) => {
    const [connection] = await systemDb.select({ tenantId: listingConnections.tenantId }).from(listingConnections).where(eq(listingConnections.account, account)).limit(1);
    if (connection) await syncListing(connection.tenantId);
  };

  // Public on purpose: it plays Google's own page, opened from the link in a review request.
  app.get("/api/dev/simulator/google/:account", async (req) => {
    const { account } = parseInput(googleAccount, req.params);
    return simGoogle(account);
  });

  app.post("/api/dev/simulator/google/:account/reviews", async (req, reply) => {
    const { account } = parseInput(googleAccount, req.params);
    const input = parseInput(simGoogleReviewInput, req.body);
    if (!simulatorListings.view(account)) throw notFound("Listing");
    simulatorListings.addReview(account, { reviewer: input.reviewer, rating: input.rating, text: input.text || null });
    await syncOwner(account);
    return reply.status(201).send(simGoogle(account));
  });

  /** Makes Google refuse the next reply, to try the retry and the error the owner sees (C-47 AC 6). */
  app.post("/api/dev/simulator/google/:account/fail-next-reply", async (req) => {
    const { account } = parseInput(googleAccount, req.params);
    const { fail } = parseInput(z.object({ fail: z.boolean() }), req.body);
    if (!simulatorListings.view(account)) throw notFound("Listing");
    simulatorListings.setFailNextReply(account, fail);
    return simGoogle(account);
  });

  /** Sends this business's waiting review requests now instead of after the wait (C-46). */
  app.post("/api/dev/simulator/review-requests/send-now", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return sendWaitingRequestsNow(ctx.tenantId);
  });

  /** Sends a booking's day-before reminder now, to try YES / NO replies without waiting (C-20). */
  app.post("/api/dev/simulator/bookings/:id/remind", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    const { id } = parseInput(z.object({ id: z.uuid() }), req.params);
    await sendReminder(ctx.tenantId, id);
    return { ok: true };
  });

  /** Runs the 15-minute booking job now: due reminders and expired waitlist offers. */
  app.post("/api/dev/simulator/bookings/tick", async (req) => {
    await tenantContext(req, ["owner"]);
    await bookingsTickJob();
    return { ok: true };
  });

  /** Sends this business's value-proof summary now instead of waiting for 8 AM (C-40). */
  app.post("/api/dev/value-proof/send", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    await sendValueProof(ctx.tenantId);
    return { ok: true };
  });
}
