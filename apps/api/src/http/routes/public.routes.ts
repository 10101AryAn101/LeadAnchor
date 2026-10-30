import {
  bookingInput,
  cancelBookingInput,
  intakeSubmitFields,
  paymentReportInput,
  publicRequestFields,
  quoteDeclineInput,
  rescheduleInput,
  waitlistJoinInput,
} from "@leadanchor/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { storage } from "../../container";
import { badRequest, notFound, parseInput } from "../../lib/errors";
import {
  bookOnline,
  bookingIcs,
  cancelByCustomer,
  getPublicBooking,
  getPublicBookingContext,
  publicRescheduleSlots,
  publicSlots,
  rescheduleByCustomer,
} from "../../modules/booking/booking.service";
import { getPublicOffer, joinWaitlist, takeOffer } from "../../modules/booking/waitlist.service";
import { MAX_PHOTOS, getIntakeContext, getRequestContext, submitIntake, submitPublicRequest } from "../../modules/intake/intake.service";
import { getPublicPayment, reportPayment, startCheckout, syncPublicPayment } from "../../modules/payments/payment.service";
import { findShowcasePhoto, getPublicProfile } from "../../modules/profile/profile";
import { acceptQuote, declineQuote, getPublicQuote, publicQuotePdf } from "../../modules/quotes/quote.service";

const tokenParam = z.object({ token: z.string().min(20).max(64) });
const slugParam = z.object({ slug: z.string().min(3).max(80).regex(/^[a-z0-9-]+$/) });

/** Customer-facing endpoints. No login: the link token is the credential (C-07, C-08, C-09). */
export async function publicRoutes(app: FastifyInstance) {
  /** The business's public profile page data (C-41). */
  app.get("/api/public/profile/:slug", async (req, reply) => {
    const { slug } = parseInput(slugParam, req.params);
    const profile = await getPublicProfile(slug);
    if (!profile) throw notFound("Profile");
    reply.header("Cache-Control", "public, max-age=60");
    return profile;
  });

  /** A photo the owner chose for their public gallery; any other photo is "not found". */
  app.get("/api/public/profile/:slug/photos/:id", async (req, reply) => {
    const { slug, id } = parseInput(slugParam.extend({ id: z.uuid() }), req.params);
    const { variant } = parseInput(z.object({ variant: z.enum(["full", "thumb"]).default("thumb") }), req.query);
    const photo = await findShowcasePhoto(slug, id);
    if (!photo) throw notFound("Photo");
    const key = variant === "thumb" && photo.thumbKey ? photo.thumbKey : photo.storageKey;
    return reply.header("Content-Type", photo.mimeType).header("Cache-Control", "public, max-age=3600").send(await storage.get(key));
  });

  app.get("/api/public/intake/:token", async (req, reply) => {
    const { token } = parseInput(tokenParam, req.params);
    reply.header("Cache-Control", "no-store");
    return getIntakeContext(token);
  });

  app.post("/api/public/intake/:token", async (req, reply) => {
    const { token } = parseInput(tokenParam, req.params);
    const { fields, photos } = await readForm(req);
    const result = await submitIntake(token, parseInput(intakeSubmitFields, fields), photos, { ipAddress: req.ip ?? null });
    return reply.status(201).send(result);
  });

  /** C-10: the request form behind the website button, the Google profile link and shared links. */
  app.get("/api/public/request/:slug", async (req, reply) => {
    const { slug } = parseInput(slugParam, req.params);
    reply.header("Cache-Control", "no-store");
    return getRequestContext(slug);
  });

  app.post("/api/public/request/:slug", async (req, reply) => {
    const { slug } = parseInput(slugParam, req.params);
    const { fields, photos } = await readForm(req);
    const result = await submitPublicRequest(slug, parseInput(publicRequestFields, fields), photos, { ipAddress: req.ip ?? null });
    return reply.status(201).send(result);
  });

  /* ── Quotes (C-45): read, download, accept or decline ─────────────────── */

  app.get("/api/public/quotes/:token", async (req, reply) => {
    const { token } = parseInput(tokenParam, req.params);
    reply.header("Cache-Control", "no-store");
    return getPublicQuote(token);
  });

  app.get("/api/public/quotes/:token/pdf", async (req, reply) => {
    const { token } = parseInput(tokenParam, req.params);
    const { filename, pdf } = await publicQuotePdf(token);
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `inline; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "-")}"`)
      .header("Cache-Control", "private, no-store")
      .send(pdf);
  });

  app.post("/api/public/quotes/:token/accept", async (req) => {
    const { token } = parseInput(tokenParam, req.params);
    return acceptQuote(token, { ipAddress: req.ip ?? null });
  });

  app.post("/api/public/quotes/:token/decline", async (req) => {
    const { token } = parseInput(tokenParam, req.params);
    return declineQuote(token, parseInput(quoteDeclineInput, req.body ?? {}).reason);
  });

  /* ── Booking (C-18 … C-22): the booking page, the customer's booking, waitlist offers ── */

  app.get("/api/public/booking/:slug", async (req, reply) => {
    const { slug } = parseInput(slugParam, req.params);
    reply.header("Cache-Control", "no-store");
    return getPublicBookingContext(slug);
  });

  app.get("/api/public/booking/:slug/slots", async (req, reply) => {
    const { slug } = parseInput(slugParam, req.params);
    const { serviceId } = parseInput(z.object({ serviceId: z.uuid() }), req.query);
    reply.header("Cache-Control", "no-store");
    return publicSlots(slug, serviceId);
  });

  app.post("/api/public/booking/:slug", async (req, reply) => {
    const { slug } = parseInput(slugParam, req.params);
    return reply.status(201).send(await bookOnline(slug, parseInput(bookingInput, req.body), { ipAddress: req.ip ?? null }));
  });

  app.post("/api/public/booking/:slug/waitlist", async (req, reply) => {
    const { slug } = parseInput(slugParam, req.params);
    return reply.status(201).send(await joinWaitlist(slug, parseInput(waitlistJoinInput, req.body), { ipAddress: req.ip ?? null }));
  });

  app.get("/api/public/bookings/:token", async (req, reply) => {
    const { token } = parseInput(tokenParam, req.params);
    reply.header("Cache-Control", "no-store");
    return getPublicBooking(token);
  });

  app.get("/api/public/bookings/:token/slots", async (req, reply) => {
    const { token } = parseInput(tokenParam, req.params);
    reply.header("Cache-Control", "no-store");
    return publicRescheduleSlots(token);
  });

  app.post("/api/public/bookings/:token/cancel", async (req) => {
    const { token } = parseInput(tokenParam, req.params);
    return cancelByCustomer(token, parseInput(cancelBookingInput, req.body ?? {}).reason);
  });

  app.post("/api/public/bookings/:token/reschedule", async (req) => {
    const { token } = parseInput(tokenParam, req.params);
    return rescheduleByCustomer(token, parseInput(rescheduleInput, req.body).startsAt);
  });

  app.get("/api/public/bookings/:token/ics", async (req, reply) => {
    const { token } = parseInput(tokenParam, req.params);
    const { filename, body } = await bookingIcs(token);
    return reply.header("Content-Type", "text/calendar; charset=utf-8").header("Content-Disposition", `attachment; filename="${filename}"`).send(body);
  });

  app.get("/api/public/offers/:token", async (req, reply) => {
    const { token } = parseInput(tokenParam, req.params);
    reply.header("Cache-Control", "no-store");
    return getPublicOffer(token);
  });

  app.post("/api/public/offers/:token/take", async (req) => {
    const { token } = parseInput(tokenParam, req.params);
    return takeOffer(token);
  });

  /* ── Pay links (C-15, C-26): card checkout, Zelle or Venmo ────────────── */

  app.get("/api/public/pay/:token", async (req, reply) => {
    const { token } = parseInput(tokenParam, req.params);
    reply.header("Cache-Control", "no-store");
    return getPublicPayment(token);
  });

  /** Opens the payments provider's hosted checkout; card details are typed there, never here. */
  app.post("/api/public/pay/:token/checkout", async (req) => {
    const { token } = parseInput(tokenParam, req.params);
    return startCheckout(token);
  });

  /** Back from the checkout: check the result now instead of waiting for the provider's webhook. */
  app.post("/api/public/pay/:token/sync", async (req) => {
    const { token } = parseInput(tokenParam, req.params);
    return syncPublicPayment(token);
  });

  app.post("/api/public/pay/:token/report", async (req) => {
    const { token } = parseInput(tokenParam, req.params);
    return reportPayment(token, parseInput(paymentReportInput, req.body).method);
  });
}

/** Reads a multipart form: text fields plus up to MAX_PHOTOS photos (extra files are drained and dropped). */
async function readForm(req: FastifyRequest) {
  if (!req.isMultipart()) throw badRequest("Expected a form submission.");
  const fields: Record<string, string> = {};
  const photos: Array<{ buffer: Buffer }> = [];
  for await (const part of req.parts()) {
    if (part.type === "file") {
      const buffer = await part.toBuffer();
      if (buffer.length > 0 && photos.length < MAX_PHOTOS) photos.push({ buffer });
    } else {
      fields[part.fieldname] = String(part.value ?? "");
    }
  }
  return { fields, photos };
}
