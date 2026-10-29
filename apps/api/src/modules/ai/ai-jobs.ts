import { and, asc, eq } from "drizzle-orm";
import { withTenant } from "../../db/client";
import { customers, leads, mediaAssets, services, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import type { JobPayloads, QUEUES } from "../../jobs/queue";
import { logger } from "../../lib/logger";
import { ai, storage } from "../../container";
import { addLeadEvent, higherUrgency } from "../leads/lead-capture";

/** Plain words for the lead's timeline; the technical error stays in the logs. */
function skipReason(error: unknown, attempts: number) {
  const status = (error as { status?: number } | null)?.status;
  const why =
    status === 429 ? "the AI's daily limit was reached" : status === 500 || status === 503 ? "the AI service was busy" : "the AI service didn't answer";
  return `No AI summary this time: ${why} (tried ${attempts} times). The customer's own words are kept instead.`;
}

/** C-13 / C-39: turn what the caller said into a clear lead card. */
export async function extractCallerNeedJob(job: JobPayloads[typeof QUEUES.extractCallerNeed], attempt = { retryCount: 0, isLast: true }) {
  const { tenantId, leadId, transcript, source } = job;
  if (!ai.configured) {
    const reason = "No AI summary: AI isn't set up yet. The customer's own words are kept instead.";
    await tenantWork(tenantId, (tx) => addLeadEvent(tx, { tenantId, leadId, type: "ai.skipped", data: { reason } }));
    return;
  }

  const context = await withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const serviceRows = await tx
      .select({ name: services.name })
      .from(services)
      .where(and(eq(services.tenantId, tenantId), eq(services.active, true)))
      .orderBy(asc(services.sortOrder));
    return { tenant: tenant!, services: serviceRows.map((s) => s.name) };
  });

  const started = Date.now();
  let need;
  try {
    need = await ai.extractCallerNeed({
      transcript,
      source,
      businessName: context.tenant.name,
      trade: context.tenant.trade,
      services: context.services,
    });
  } catch (error) {
    if (!attempt.isLast) throw error; // the queue retries with backoff
    logger.warn({ err: error, leadId, attempts: attempt.retryCount + 1 }, "caller-need summary skipped");
    await tenantWork(tenantId, async (tx, fx) => {
      await addLeadEvent(tx, {
        tenantId,
        leadId,
        type: "ai.skipped",
        actor: "ai",
        data: { reason: skipReason(error, attempt.retryCount + 1) },
      });
      fx.publish({ type: "lead.updated", leadId });
    });
    return;
  }

  await tenantWork(tenantId, async (tx, fx) => {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId));
    if (!lead) return;

    await tx
      .update(leads)
      .set({
        ...(lead.titleLocked ? {} : { title: need.title }),
        summary: need.summary,
        urgency: higherUrgency(lead.urgency, need.urgency),
        serviceCategory: lead.serviceCategory ?? need.serviceCategory,
      })
      .where(eq(leads.id, leadId));

    if (need.callerName || need.address) {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, lead.customerId));
      if (customer) {
        await tx
          .update(customers)
          .set({ name: customer.name ?? need.callerName, address: customer.address ?? need.address })
          .where(eq(customers.id, customer.id));
      }
    }

    await addLeadEvent(tx, {
      tenantId,
      leadId,
      type: "ai.extracted",
      actor: "ai",
      data: { ...need, source, model: ai.model, ms: Date.now() - started },
    });
    fx.publish({ type: "lead.updated", leadId });
  });
}

/** C-09: read a customer photo so the owner can quote without a site visit. */
export async function triagePhotoJob(job: JobPayloads[typeof QUEUES.triagePhoto], attempt = { retryCount: 0, isLast: true }) {
  const { tenantId, mediaId } = job;

  const media = await withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(mediaAssets).where(eq(mediaAssets.id, mediaId));
    if (!row) return null;
    const [tenant] = await tx.select({ trade: tenants.trade }).from(tenants).where(eq(tenants.id, tenantId));
    const [lead] = row.leadId ? await tx.select({ summary: leads.summary }).from(leads).where(eq(leads.id, row.leadId)) : [];
    return { row, trade: tenant!.trade, note: lead?.summary ?? undefined };
  });
  if (!media || media.row.aiStatus === "done") return;

  if (!ai.configured) {
    await withTenant(tenantId, (tx) => tx.update(mediaAssets).set({ aiStatus: "skipped" }).where(eq(mediaAssets.id, mediaId)));
    return;
  }

  try {
    const image = await storage.get(media.row.storageKey);
    const tags = await ai.triagePhoto({ image, mimeType: media.row.mimeType, trade: media.trade, customerNote: media.note });

    await tenantWork(tenantId, async (tx, fx) => {
      await tx.update(mediaAssets).set({ aiStatus: "done", aiTags: { ...tags }, aiError: null }).where(eq(mediaAssets.id, mediaId));
      const leadId = media.row.leadId;
      if (!leadId) return;
      const [lead] = await tx.select({ urgency: leads.urgency }).from(leads).where(eq(leads.id, leadId));
      if (lead) await tx.update(leads).set({ urgency: higherUrgency(lead.urgency, tags.urgency) }).where(eq(leads.id, leadId));
      await addLeadEvent(tx, { tenantId, leadId, type: "photo.analyzed", actor: "ai", data: { mediaId, ...tags, model: ai.model } });
      fx.publish({ type: "lead.updated", leadId });
    });
  } catch (error) {
    logger.error({ err: error, mediaId, retryCount: attempt.retryCount }, "photo triage failed");
    if (!attempt.isLast) throw error; // the queue retries with backoff
    await withTenant(tenantId, (tx) =>
      tx.update(mediaAssets).set({ aiStatus: "failed", aiError: (error as Error).message.slice(0, 500) }).where(eq(mediaAssets.id, mediaId)),
    );
  }
}
