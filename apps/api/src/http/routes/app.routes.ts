import {
  type MeResponse,
  dashboardRange,
  forwardingCheckInput,
  leadContactInput,
  leadUpdateInput,
  mediaUpdateInput,
  requestDetailsInput,
  noteInput,
  onboardingInput,
  registrationInput,
  serviceInput,
  serviceOrderInput,
  serviceUpdateInput,
  settingsUpdateInput,
  toE164,
} from "@leadanchor/contracts";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { webOrigins } from "../../config/env";
import { withTenant } from "../../db/client";
import { mediaAssets } from "../../db/schema";
import { notFound, parseInput } from "../../lib/errors";
import { realtime } from "../../lib/realtime";
import { storage } from "../../container";
import { listCalls } from "../../modules/calls/call.queries";
import { createService, listServices, reorderServices, updateService } from "../../modules/catalog/catalog.service";
import { getCustomer, listCustomers } from "../../modules/customers/customer.queries";
import { consentLedger } from "../../container";
import { getRegistration, submitRegistration } from "../../modules/compliance/registration.service";
import { getDashboard } from "../../modules/dashboard/dashboard.service";
import { integrationStatuses } from "../../modules/integrations/integration-status";
import { addNote, getLeadDetail, listBoard, recordContact, requestDetails, updateLead } from "../../modules/leads/lead.service";
import { listNotifications, markNotificationsRead } from "../../modules/notifications/notification.queries";
import { startForwardingCheck } from "../../modules/tenants/forwarding";
import { findMembership, getSettings, getTenantSummary, onboardTenant, updateSettings } from "../../modules/tenants/tenant.service";
import { tenantContext, userContext } from "../context";

const idParam = z.object({ id: z.uuid() });

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
