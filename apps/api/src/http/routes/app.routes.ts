import {
  type MeResponse,
  bookingSettings,
  CALENDAR_PROVIDERS,
  LISTING_PROVIDERS,
  assistantSettingsInput,
  campaignAudience,
  campaignCreateInput,
  campaignSendInput,
  campaignUpdateInput,
  chatHandlerInput,
  membershipActionInput,
  planInput,
  chatReplyInput,
  dashboardRange,
  listingPostInput,
  listingSettingsInput,
  reviewPatchInput,
  reviewReplyInput,
  forwardingCheckInput,
  leadContactInput,
  leadUpdateInput,
  mediaUpdateInput,
  requestDetailsInput,
  noShowInput,
  noteInput,
  ownerBookingInput,
  ownerCancelInput,
  pushDeviceInput,
  onboardingInput,
  paymentRecordInput,
  paymentRequestInput,
  paymentSettingsInput,
  quoteUpdateInput,
  registrationCodeInput,
  registrationInput,
  serviceInput,
  serviceOrderInput,
  sendInput,
  serviceUpdateInput,
  settingsUpdateInput,
  toE164,
} from "@leadanchor/contracts";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { env, webOrigins } from "../../config/env";
import { withTenant } from "../../db/client";
import { mediaAssets } from "../../db/schema";
import { notFound, parseInput } from "../../lib/errors";
import { realtime } from "../../lib/realtime";
import { storage } from "../../container";
import { listCalls } from "../../modules/calls/call.queries";
import { createService, listServices, reorderServices, updateService } from "../../modules/catalog/catalog.service";
import { getBookingSettings, markNoShow, ownerBook, ownerCancel, ownerSlots, updateBookingSettings } from "../../modules/booking/booking.service";
import { connectCalendar, disconnectCalendar, syncCalendar } from "../../modules/booking/calendar-sync";
import { listWaitlist, removeFromWaitlist } from "../../modules/booking/waitlist.service";
import {
  approveCampaign,
  campaignOptions,
  createCampaign,
  deleteCampaign,
  draftCampaignCopy,
  getCampaign,
  listCampaigns,
  previewAudience,
  previewCampaign,
  sendTestEmail,
  unscheduleCampaign,
  updateCampaign,
} from "../../modules/campaigns/campaign.service";
import { getAssistantSettings, getChat, listChats, ownerReply, setHandler, updateAssistantSettings } from "../../modules/chat/chat.service";
import { getMembership, listMemberships, membershipAction } from "../../modules/memberships/membership.service";
import { createPlan, listPlans, setPlanArchived, updatePlan } from "../../modules/memberships/plans.service";
import {
  connectListing,
  disconnectListing,
  draftListingPost,
  getListing,
  publishListingPost,
  syncListingNow,
  updateListingSettings,
} from "../../modules/reviews/listing.service";
import { approveReply, getReviews, getReviewsSummary, redraftReply, setShowOnProfile } from "../../modules/reviews/reviews.service";
import { getCustomer, listCustomers } from "../../modules/customers/customer.queries";
import { consentLedger } from "../../container";
import {
  confirmRegistrationCode,
  getRegistration,
  resendRegistrationCode,
  retryRegistration,
  submitRegistration,
} from "../../modules/compliance/registration.service";
import { getDashboard } from "../../modules/dashboard/dashboard.service";
import { integrationStatuses } from "../../modules/integrations/integration-status";
import { addNote, getLeadDetail, listBoard, recordContact, requestDetails, updateLead } from "../../modules/leads/lead.service";
import { listTags } from "../../modules/leads/tags";
import { listNotifications, markNotificationsRead } from "../../modules/notifications/notification.queries";
import { addPushDevice, listPushDevices, removePushDevice, sendTestAlert } from "../../modules/notifications/push";
import {
  cancelPaymentRequest,
  capturePayment,
  connectPayments,
  getPaymentSettings,
  recordPayment,
  refreshPaymentAccount,
  releasePayment,
  requestPayment,
  resendPaymentLink,
  updatePaymentSettings,
} from "../../modules/payments/payment.service";
import { createQuote, discardQuote, getQuote, quotePdf, redraftQuote, reopenQuote, sendQuote, updateQuote } from "../../modules/quotes/quote.service";
import { startForwardingCheck } from "../../modules/tenants/forwarding";
import { findMembership, getSettings, getTenantSummary, onboardTenant, updateSettings } from "../../modules/tenants/tenant.service";
import { tenantContext, userContext } from "../context";

const idParam = z.object({ id: z.uuid() });

/** The web address the owner is using, so a provider's setup page sends them back to the same place (and session). */
const ownerOrigin = (req: FastifyRequest) => {
  const origin = req.headers.origin;
  return origin && webOrigins.includes(origin) ? origin : env.PUBLIC_WEB_URL;
};

/** A PDF shown in the browser, with a sensible name when saved. */
const pdfHeaders = (filename: string) => ({
  "Content-Type": "application/pdf",
  "Content-Disposition": `inline; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "-")}"`,
  "Cache-Control": "private, no-store",
});

export async function appRoutes(app: FastifyInstance) {
  /* ── Session & onboarding ─────────────────────────────────────────────── */

  app.get("/api/me", async (req): Promise<MeResponse> => {
    const user = await userContext(req);
    const membership = await findMembership(user.userId);
    return {
      user: { id: user.userId, name: user.name, email: user.email },
      tenant: membership ? await getTenantSummary(membership.tenantId) : null,
      role: membership?.role ?? null,
    };
  });

  app.post("/api/onboarding", async (req, reply) => {
    const user = await userContext(req);
    const input = parseInput(onboardingInput, req.body);
    const tenantId = await onboardTenant(user.userId, input);
    return reply.status(201).send({ tenant: await getTenantSummary(tenantId) });
  });

  /* ── Dashboard (C-14, C-40) ───────────────────────────────────────────── */

  app.get("/api/dashboard", async (req) => {
    const ctx = await tenantContext(req);
    const { range } = parseInput(z.object({ range: dashboardRange.default("30d") }), req.query);
    return getDashboard(ctx.tenantId, range);
  });

  /* ── Leads (C-12, C-34) ───────────────────────────────────────────────── */

  app.get("/api/leads", async (req) => {
    const ctx = await tenantContext(req);
    return { leads: await listBoard(ctx.tenantId) };
  });

  app.get("/api/leads/:id", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return getLeadDetail(ctx.tenantId, id);
  });

  app.patch("/api/leads/:id", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return updateLead(ctx.tenantId, ctx.userId, id, parseInput(leadUpdateInput, req.body));
  });

  app.post("/api/leads/:id/notes", async (req, reply) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    await addNote(ctx.tenantId, ctx.userId, id, parseInput(noteInput, req.body).text);
    return reply.status(201).send({ ok: true });
  });

  app.post("/api/leads/:id/request-details", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return requestDetails(ctx.tenantId, ctx.userId, id, parseInput(requestDetailsInput, req.body ?? {}));
  });

  /** The owner tapped Call or Text on this lead (the phone itself places the call or opens the text). */
  app.post("/api/leads/:id/contact", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return recordContact(ctx.tenantId, ctx.userId, id, parseInput(leadContactInput, req.body).channel);
  });

  /* ── Quotes (module 6, C-45) ──────────────────────────────────────────── */

  /** "Draft quote": the AI's first draft from the photos and the price list. Nothing is sent. */
  app.post("/api/leads/:id/quotes", async (req, reply) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    const { quote, created } = await createQuote(ctx.tenantId, ctx.userId, id);
    return reply.status(created ? 201 : 200).send(quote);
  });

  app.get("/api/quotes/:id", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return getQuote(ctx.tenantId, id);
  });

  app.patch("/api/quotes/:id", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return updateQuote(ctx.tenantId, ctx.userId, id, parseInput(quoteUpdateInput, req.body));
  });

  /** The owner's approval: the only way a quote reaches the customer (C-45). */
  app.post("/api/quotes/:id/send", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return sendQuote(ctx.tenantId, ctx.userId, id, parseInput(sendInput, req.body ?? {}));
  });

  /** "Try the AI again" on a draft that never went out. */
  app.post("/api/quotes/:id/redraft", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return redraftQuote(ctx.tenantId, ctx.userId, id);
  });

  app.post("/api/quotes/:id/reopen", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return reopenQuote(ctx.tenantId, ctx.userId, id);
  });

  app.delete("/api/quotes/:id", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    await discardQuote(ctx.tenantId, ctx.userId, id);
    return { ok: true };
  });

  app.get("/api/quotes/:id/pdf", async (req, reply) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    const { filename, pdf } = await quotePdf(ctx.tenantId, id);
    return reply.headers(pdfHeaders(filename)).send(pdf);
  });

  /* ── Payments (module 7, C-15, C-26) ──────────────────────────────────── */

  app.post("/api/leads/:id/payments", async (req, reply) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return reply.status(201).send(await requestPayment(ctx.tenantId, ctx.userId, id, parseInput(paymentRequestInput, req.body)));
  });

  /** Zelle, Venmo, cash or a check: money the owner marks as received. */
  app.post("/api/leads/:id/payments/record", async (req, reply) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return reply.status(201).send(await recordPayment(ctx.tenantId, ctx.userId, id, parseInput(paymentRecordInput, req.body)));
  });

  app.post("/api/payments/:id/capture", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return capturePayment(ctx.tenantId, ctx.userId, id);
  });

  app.post("/api/payments/:id/release", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return releasePayment(ctx.tenantId, ctx.userId, id);
  });

  app.post("/api/payments/:id/cancel", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return cancelPaymentRequest(ctx.tenantId, ctx.userId, id);
  });

  app.post("/api/payments/:id/resend", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return resendPaymentLink(ctx.tenantId, ctx.userId, id, parseInput(sendInput, req.body ?? {}));
  });

  app.get("/api/payments/settings", async (req) => {
    const ctx = await tenantContext(req);
    return getPaymentSettings(ctx.tenantId);
  });

  app.patch("/api/payments/settings", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return updatePaymentSettings(ctx.tenantId, ctx.userId, parseInput(paymentSettingsInput, req.body));
  });

  /** Opens the business's own payments account and returns the provider's setup page. */
  app.post("/api/payments/connect", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return connectPayments(ctx.tenantId, ctx.userId, `${ownerOrigin(req)}/settings?payments=back#payments`);
  });

  app.post("/api/payments/settings/refresh", async (req) => {
    const ctx = await tenantContext(req);
    return refreshPaymentAccount(ctx.tenantId);
  });

  /* ── Booking (module 8, C-17 … C-22) ──────────────────────────────────── */

  app.get("/api/booking/settings", async (req) => {
    const ctx = await tenantContext(req);
    return getBookingSettings(ctx.tenantId);
  });

  app.put("/api/booking/settings", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    return updateBookingSettings(ctx.tenantId, ctx.userId, parseInput(bookingSettings, req.body));
  });

  /** Free times for this job's visit, from the opening hours, bookings and the owner's calendar. */
  app.get("/api/leads/:id/slots", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    const query = parseInput(z.object({ serviceId: z.uuid().optional(), durationMins: z.coerce.number().int().min(15).max(720).optional() }), req.query);
    return ownerSlots(ctx.tenantId, id, query);
  });

  app.post("/api/leads/:id/booking", async (req, reply) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return reply.status(201).send(await ownerBook(ctx.tenantId, ctx.userId, id, parseInput(ownerBookingInput, req.body)));
  });

  app.post("/api/leads/:id/booking/cancel", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    await ownerCancel(ctx.tenantId, ctx.userId, id, parseInput(ownerCancelInput, req.body ?? {}));
    return { ok: true };
  });

  app.post("/api/bookings/:id/no-show", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    await markNoShow(ctx.tenantId, ctx.userId, id, parseInput(noShowInput, req.body ?? {}));
    return { ok: true };
  });

  app.get("/api/waitlist", async (req) => {
    const ctx = await tenantContext(req);
    return { entries: await listWaitlist(ctx.tenantId) };
  });

  app.delete("/api/waitlist/:id", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    await removeFromWaitlist(ctx.tenantId, ctx.userId, id);
    return { ok: true };
  });

  /** Two-way calendar sync (module 8). Real providers send the owner to sign in first. */
  app.post("/api/calendar/connect", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    const { provider } = parseInput(z.object({ provider: z.enum(CALENDAR_PROVIDERS) }), req.body);
    return connectCalendar(ctx.tenantId, ctx.userId, provider, `${ownerOrigin(req)}/settings?calendar=back#booking`);
  });

  app.post("/api/calendar/disconnect", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    await disconnectCalendar(ctx.tenantId, ctx.userId);
    return getBookingSettings(ctx.tenantId);
  });

  app.post("/api/calendar/sync", async (req) => {
    const ctx = await tenantContext(req);
    await syncCalendar(ctx.tenantId);
    return getBookingSettings(ctx.tenantId);
  });

  /* ── Chats: WhatsApp, the website chat and texts (C-11, C-16) ─────────── */

  app.get("/api/chats", async (req) => {
    const ctx = await tenantContext(req);
    return listChats(ctx.tenantId);
  });

  app.get("/api/chats/:id", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return getChat(ctx.tenantId, id);
  });

  /** The owner writes in the chat; the assistant steps back until the chat is handed back. */
  app.post("/api/chats/:id/reply", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return ownerReply(ctx.tenantId, ctx.userId, id, parseInput(chatReplyInput, req.body).text);
  });

  app.post("/api/chats/:id/handler", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return setHandler(ctx.tenantId, ctx.userId, id, parseInput(chatHandlerInput, req.body).handler);
  });

  app.get("/api/assistant", async (req) => {
    const ctx = await tenantContext(req);
    return getAssistantSettings(ctx.tenantId);
  });

  app.put("/api/assistant", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    return updateAssistantSettings(ctx.tenantId, ctx.userId, parseInput(assistantSettingsInput, req.body));
  });

  /* ── Email campaigns (module 11; C-28, C-29, C-30, C-44) ───────────────── */

  app.get("/api/campaigns", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    return listCampaigns(ctx.tenantId);
  });

  app.get("/api/campaigns/options", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    return campaignOptions(ctx.tenantId);
  });

  /** Who an audience reaches right now, and who it leaves out and why. */
  app.post("/api/campaigns/audience", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    return previewAudience(ctx.tenantId, parseInput(campaignAudience, req.body));
  });

  app.post("/api/campaigns", async (req, reply) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const created = await createCampaign(ctx.tenantId, parseInput(campaignCreateInput, req.body).kind);
    return reply.status(201).send(created);
  });

  app.get("/api/campaigns/:id", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return getCampaign(ctx.tenantId, id);
  });

  app.patch("/api/campaigns/:id", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return updateCampaign(ctx.tenantId, id, parseInput(campaignUpdateInput, req.body));
  });

  app.delete("/api/campaigns/:id", async (req, reply) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    await deleteCampaign(ctx.tenantId, id);
    return reply.status(204).send();
  });

  /** The AI's subject and message; not saved until the owner keeps them. */
  app.post("/api/campaigns/:id/draft", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return draftCampaignCopy(ctx.tenantId, id);
  });

  app.get("/api/campaigns/:id/preview", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return previewCampaign(ctx.tenantId, id);
  });

  app.post("/api/campaigns/:id/test", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return sendTestEmail(ctx.tenantId, id, { name: ctx.name, email: ctx.email });
  });

  /** The owner's approval: send now or at a set time (C-30: nothing goes out without it). */
  app.post("/api/campaigns/:id/send", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    const { id } = parseInput(idParam, req.params);
    return approveCampaign(ctx.tenantId, id, parseInput(campaignSendInput, req.body), ctx);
  });

  app.post("/api/campaigns/:id/unschedule", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    const { id } = parseInput(idParam, req.params);
    return unscheduleCampaign(ctx.tenantId, id, ctx);
  });

  /* ── Memberships (module 12; C-48 … C-52) ─────────────────────────────── */

  app.get("/api/memberships", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    return listMemberships(ctx.tenantId);
  });

  app.get("/api/memberships/:id", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return getMembership(ctx.tenantId, id);
  });

  /** Pause, resume, cancel, change plan or retry a bill: written back to Stripe and audited (C-50 AC 3). */
  app.post("/api/memberships/:id/action", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    const { id } = parseInput(idParam, req.params);
    return membershipAction(ctx.tenantId, id, parseInput(membershipActionInput, req.body), ctx);
  });

  app.get("/api/membership-plans", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    return listPlans(ctx.tenantId);
  });

  app.post("/api/membership-plans", async (req, reply) => {
    const ctx = await tenantContext(req, ["owner"]);
    const plan = await createPlan(ctx.tenantId, parseInput(planInput, req.body), `user:${ctx.userId}`);
    return reply.status(201).send(plan);
  });

  app.patch("/api/membership-plans/:id", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    const { id } = parseInput(idParam, req.params);
    return updatePlan(ctx.tenantId, id, parseInput(planInput, req.body), `user:${ctx.userId}`);
  });

  /** Archived plans take no new members; existing members carry on (C-48 AC 4). */
  app.post("/api/membership-plans/:id/archive", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    const { id } = parseInput(idParam, req.params);
    const { archived } = parseInput(z.object({ archived: z.boolean() }), req.body);
    return setPlanArchived(ctx.tenantId, id, archived, `user:${ctx.userId}`);
  });

  /* ── Reviews and the Google listing (module 9, C-21, C-23, C-46, C-47) ─── */

  app.get("/api/reviews", async (req) => {
    const ctx = await tenantContext(req);
    return getReviews(ctx.tenantId);
  });

  app.get("/api/reviews/summary", async (req) => {
    const ctx = await tenantContext(req);
    return getReviewsSummary(ctx.tenantId);
  });

  /** A fresh AI draft of the reply. */
  app.post("/api/reviews/:id/draft", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return redraftReply(ctx.tenantId, id);
  });

  /** The owner approves the reply; it posts to Google in the background (C-47). */
  app.post("/api/reviews/:id/reply", async (req, reply) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return reply.status(202).send(await approveReply(ctx.tenantId, ctx.userId, id, parseInput(reviewReplyInput, req.body).text));
  });

  app.patch("/api/reviews/:id", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return setShowOnProfile(ctx.tenantId, ctx.userId, id, parseInput(reviewPatchInput, req.body).showOnProfile);
  });

  app.get("/api/listing", async (req) => {
    const ctx = await tenantContext(req);
    return getListing(ctx.tenantId);
  });

  /** Google sends the owner to sign in first (step 2); the simulator connects straight away. */
  app.post("/api/listing/connect", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    const { provider } = parseInput(z.object({ provider: z.enum(LISTING_PROVIDERS) }), req.body);
    return connectListing(ctx.tenantId, ctx.userId, provider, `${ownerOrigin(req)}/settings?google=back#google`);
  });

  app.post("/api/listing/disconnect", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return disconnectListing(ctx.tenantId, ctx.userId);
  });

  /** Update Google now and read it back: details out, rating and reviews in. */
  app.post("/api/listing/sync", async (req) => {
    const ctx = await tenantContext(req);
    return syncListingNow(ctx.tenantId);
  });

  app.put("/api/listing/settings", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    return updateListingSettings(ctx.tenantId, ctx.userId, parseInput(listingSettingsInput, req.body));
  });

  app.post("/api/listing/posts/draft", async (req) => {
    const ctx = await tenantContext(req);
    return draftListingPost(ctx.tenantId);
  });

  app.post("/api/listing/posts", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    return publishListingPost(ctx.tenantId, ctx.userId, parseInput(listingPostInput, req.body).text);
  });

  /** Tags in use, for the board filter and the tag picker (module 4). */
  app.get("/api/tags", async (req) => {
    const ctx = await tenantContext(req);
    return listTags(ctx.tenantId);
  });

  /* ── Customers (C-34) ─────────────────────────────────────────────────── */

  app.get("/api/customers", async (req) => {
    const ctx = await tenantContext(req);
    const { q } = parseInput(z.object({ q: z.string().max(80).optional().default("") }), req.query);
    return { customers: await listCustomers(ctx.tenantId, q) };
  });

  app.get("/api/customers/:id", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return getCustomer(ctx.tenantId, id);
  });

  /* ── Services and prices (C-17) ───────────────────────────────────────── */

  app.get("/api/services", async (req) => {
    const ctx = await tenantContext(req);
    return { services: await listServices(ctx.tenantId) };
  });

  app.post("/api/services", async (req, reply) => {
    const ctx = await tenantContext(req);
    return reply.status(201).send(await createService(ctx.tenantId, ctx.userId, parseInput(serviceInput, req.body)));
  });

  app.post("/api/services/order", async (req) => {
    const ctx = await tenantContext(req);
    return { services: await reorderServices(ctx.tenantId, parseInput(serviceOrderInput, req.body).ids) };
  });

  app.patch("/api/services/:id", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return updateService(ctx.tenantId, ctx.userId, id, parseInput(serviceUpdateInput, req.body));
  });

  /* ── Calls ────────────────────────────────────────────────────────────── */

  app.get("/api/calls", async (req) => {
    const ctx = await tenantContext(req);
    return { calls: await listCalls(ctx.tenantId) };
  });

  /* ── Notifications ────────────────────────────────────────────────────── */

  app.get("/api/notifications", async (req) => {
    const ctx = await tenantContext(req);
    return listNotifications(ctx.tenantId);
  });

  app.post("/api/notifications/read", async (req) => {
    const ctx = await tenantContext(req);
    const { ids } = parseInput(z.object({ ids: z.array(z.uuid()).optional() }), req.body ?? {});
    await markNotificationsRead(ctx.tenantId, ids);
    return { ok: true };
  });

  /* ── Phone alerts (C-05) ──────────────────────────────────────────────── */

  app.get("/api/push/devices", async (req) => {
    const ctx = await tenantContext(req);
    return listPushDevices(ctx.tenantId);
  });

  app.post("/api/push/devices", async (req, reply) => {
    const ctx = await tenantContext(req);
    return reply.status(201).send(await addPushDevice(ctx.tenantId, ctx.userId, parseInput(pushDeviceInput, req.body)));
  });

  app.delete("/api/push/devices/:id", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    await removePushDevice(ctx.tenantId, id);
    return { ok: true };
  });

  /** A test alert to one phone, so the owner sees what a missed call looks like. */
  app.post("/api/push/devices/:id/test", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    return { status: await sendTestAlert(ctx.tenantId, id) };
  });

  /* ── Settings ─────────────────────────────────────────────────────────── */

  app.get("/api/settings", async (req) => {
    const ctx = await tenantContext(req);
    return getSettings(ctx.tenantId);
  });

  app.patch("/api/settings", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    return updateSettings(ctx.tenantId, ctx.userId, parseInput(settingsUpdateInput, req.body));
  });

  /** C-01: ring the owner's cell and check that the call comes back to the LeadAnchor number. */
  app.post("/api/settings/forwarding-check", async (req, reply) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    await startForwardingCheck(ctx.tenantId, ctx.userId, parseInput(forwardingCheckInput, req.body ?? {}));
    return reply.status(202).send(await getSettings(ctx.tenantId));
  });

  /* ── Compliance (C-27, C-43) ──────────────────────────────────────────── */

  app.get("/api/compliance/registration", async (req) => {
    const ctx = await tenantContext(req);
    return getRegistration(ctx.tenantId);
  });

  app.post("/api/compliance/registration", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return submitRegistration(ctx.tenantId, ctx.userId, parseInput(registrationInput, req.body));
  });

  /** Sole proprietors confirm their mobile with the code the carriers texted (C-43). */
  app.post("/api/compliance/registration/code", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return confirmRegistrationCode(ctx.tenantId, ctx.userId, parseInput(registrationCodeInput, req.body).code);
  });

  app.post("/api/compliance/registration/code/resend", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return resendRegistrationCode(ctx.tenantId, ctx.userId);
  });

  /** Files the texting plan (or the number hookup) again after the carriers turned it down. */
  app.post("/api/compliance/registration/retry", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return retryRegistration(ctx.tenantId, ctx.userId);
  });

  app.get("/api/compliance/consent", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { phone } = parseInput(z.object({ phone: z.string().optional() }), req.query);
    const phoneE164 = phone ? (toE164(phone) ?? undefined) : undefined;
    const records = await consentLedger.list(ctx.tenantId, { phoneE164 });
    return {
      backend: consentLedger.backend,
      entries: records.map((r) => ({
        id: r.id,
        phone: r.phoneE164,
        type: r.type,
        action: r.action,
        source: r.source,
        textVersion: r.textVersion,
        evidence: r.evidence ?? null,
        recordedAt: r.recordedAt.toISOString(),
      })),
    };
  });

  /* ── Integrations ─────────────────────────────────────────────────────── */

  app.get("/api/integrations", async (req) => {
    const ctx = await tenantContext(req);
    const registration = await getRegistration(ctx.tenantId);
    return { integrations: integrationStatuses(registration.status) };
  });

  /* ── Media (customer photos) ──────────────────────────────────────────── */

  /** Show or hide a photo in the public work gallery (C-41). */
  app.patch("/api/media/:id", async (req) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    const { showcase } = parseInput(mediaUpdateInput, req.body);
    const [row] = await withTenant(ctx.tenantId, (tx) =>
      tx.update(mediaAssets).set({ showcase }).where(eq(mediaAssets.id, id)).returning({ id: mediaAssets.id, showcase: mediaAssets.showcase }),
    );
    if (!row) throw notFound("Photo");
    return row;
  });

  app.get("/api/media/:id", async (req, reply) => {
    const ctx = await tenantContext(req);
    const { id } = parseInput(idParam, req.params);
    const { variant } = parseInput(z.object({ variant: z.enum(["full", "thumb"]).default("full") }), req.query);
    const [media] = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.tenantId, ctx.tenantId))).limit(1),
    );
    if (!media) throw notFound("Photo");
    const key = variant === "thumb" && media.thumbKey ? media.thumbKey : media.storageKey;
    return reply
      .header("Content-Type", media.mimeType)
      .header("Cache-Control", "private, max-age=86400, immutable")
      .send(await storage.get(key));
  });

  /* ── Live updates (server-sent events) ────────────────────────────────── */

  app.get("/api/events", async (req, reply) => {
    const ctx = await tenantContext(req);
    // A hijacked reply skips the CORS plugin, so allow the caller's origin here when it's one of ours.
    const origin = req.headers.origin;
    const cors = origin && webOrigins.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" } : {};
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...cors,
    });
    res.write("retry: 3000\n\n");
    const unsubscribe = realtime.subscribe(ctx.tenantId, (event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
