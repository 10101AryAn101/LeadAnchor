import {
  INTAKE_CONSENT_TEXT,
  INTAKE_CONSENT_VERSION,
  INTAKE_MARKETING_CONSENT_VERSION,
  type IntakeContext,
  type RequestSource,
  intakeMarketingConsentText,
  type intakeSubmitFields,
  type publicRequestFields,
} from "@leadanchor/contracts";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import { uuidv7 } from "uuidv7";
import { linkBaseUrl } from "../../config/env";
import { systemDb, type Tx } from "../../db/client";
import { customers, intakeRequests, leads, mediaAssets, phoneNumbers, services, tenants } from "../../db/schema";
import { type Effects, tenantWork } from "../../db/unit-of-work";
import { QUEUES } from "../../jobs/queue";
import { randomToken, sha256 } from "../../lib/crypto";
import { HttpError, notFound } from "../../lib/errors";
import { addDays } from "../../lib/time";
import { consentLedger, storage } from "../../container";
import { creditCampaign } from "../campaigns/links";
import { addLeadEvent, captureLead } from "../leads/lead-capture";
import { notifyOwner } from "../notifications/notify";
import { type ProcessedPhoto, processPhoto } from "./photo";

const LINK_TTL_DAYS = 7;
export const MAX_PHOTOS = 5;

type SubmitFields = z.output<typeof intakeSubmitFields>;
type Tenant = typeof tenants.$inferSelect;

/** The business's public request form (C-10): behind its website button, Google profile and shared links. */
export const requestUrl = (slug: string) => `${linkBaseUrl}/r/${slug}`;

/** Where a public request came from, as the owner reads it. */
const SOURCE_PHRASE: Record<RequestSource, string> = { website: "your website", google: "Google", link: "your request link" };

/** Creates a fresh no-login request link for a lead (C-07). Only the token hash is stored. */
export async function createIntakeLink(tx: Tx, input: { tenantId: string; leadId: string; customerId: string }) {
  const token = randomToken();
  await tx.insert(intakeRequests).values({
    tenantId: input.tenantId,
    leadId: input.leadId,
    customerId: input.customerId,
    tokenHash: sha256(token),
    expiresAt: addDays(new Date(), LINK_TTL_DAYS),
  });
  await tx.update(leads).set({ intakeStatus: "link_sent" }).where(eq(leads.id, input.leadId));
  return `${linkBaseUrl}/i/${token}`;
}

/** Looks a token up across businesses (system role): the token itself is the credential. */
async function resolve(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound("Link");
  const [request] = await systemDb.select().from(intakeRequests).where(eq(intakeRequests.tokenHash, sha256(token))).limit(1);
  if (!request) throw notFound("Link");
  return request;
}

async function tenantBySlug(slug: string) {
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!tenant) throw notFound("Business");
  return tenant;
}

const statusOf = (request: typeof intakeRequests.$inferSelect): IntakeContext["status"] =>
  request.status === "submitted" ? "submitted" : request.expiresAt < new Date() ? "expired" : "open";

/** What the form shows about the business: name, trade, trust badges and its services. */
async function businessContext(tx: Tx, tenant: Tenant): Promise<Pick<IntakeContext, "business" | "services">> {
  const serviceRows = await tx
    .select({ id: services.id, name: services.name, description: services.description })
    .from(services)
    .where(and(eq(services.tenantId, tenant.id), eq(services.active, true)))
    .orderBy(asc(services.sortOrder));
  const [number] = await tx.select({ e164: phoneNumbers.e164 }).from(phoneNumbers).where(eq(phoneNumbers.tenantId, tenant.id)).limit(1);
  return {
    business: {
      name: tenant.name,
      trade: tenant.trade,
      city: tenant.city,
      state: tenant.state,
      licenseNumber: tenant.licenseNumber,
      insured: Boolean(tenant.insuranceCarrier),
      yearsInBusiness: tenant.yearsInBusiness,
      phone: number?.e164 ?? null,
    },
    services: serviceRows,
  };
}

export async function getIntakeContext(token: string): Promise<IntakeContext> {
  const request = await resolve(token);

  return tenantWork(request.tenantId, async (tx, fx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, request.tenantId));
    const [customer] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, request.customerId));

    const status = statusOf(request);
    if (status === "open" && request.status === "sent") {
      await tx.update(intakeRequests).set({ status: "opened", openedAt: new Date() }).where(eq(intakeRequests.id, request.id));
      await tx.update(leads).set({ intakeStatus: "opened" }).where(and(eq(leads.id, request.leadId), eq(leads.intakeStatus, "link_sent")));
      await addLeadEvent(tx, { tenantId: request.tenantId, leadId: request.leadId, type: "intake.opened", actor: "customer" });
      fx.publish({ type: "lead.updated", leadId: request.leadId });
    }

    return { ...(await businessContext(tx, tenant!)), customerName: customer?.name ?? null, status };
  });
}

/** The public form for a business (C-10). Anyone can open it; there's no lead until they send it. */
export async function getRequestContext(slug: string): Promise<IntakeContext> {
  const tenant = await tenantBySlug(slug);
  return tenantWork(tenant.id, async (tx) => ({ ...(await businessContext(tx, tenant)), customerName: null, status: "open" as const }));
}

export interface UploadedPhoto {
  buffer: Buffer;
}

interface StoredPhoto {
  id: string;
  storageKey: string;
  thumbKey: string;
  processed: ProcessedPhoto;
}

/** Resizes and stores photos before any transaction opens: slow work stays outside the database. */
async function storePhotos(tenantId: string, photos: UploadedPhoto[]) {
  const stored: StoredPhoto[] = [];
  for (const photo of photos.slice(0, MAX_PHOTOS)) {
    const processed = await processPhoto(photo.buffer);
    const id = uuidv7();
    const month = new Date().toISOString().slice(0, 7);
    const storageKey = `${tenantId}/${month}/${id}.webp`;
    const thumbKey = `${tenantId}/${month}/${id}.thumb.webp`;
    await storage.put(storageKey, processed.data);
    await storage.put(thumbKey, processed.thumb);
    stored.push({ id, storageKey, thumbKey, processed });
  }
  return stored;
}

/** Stores the customer's answers and photos on a request link, then queues AI triage (C-08, C-09). */
export async function submitIntake(token: string, fields: SubmitFields, photos: UploadedPhoto[], meta: { ipAddress: string | null } = { ipAddress: null }) {
  const request = await resolve(token);
  const status = statusOf(request);
  if (status === "submitted") throw new HttpError(409, "already_submitted", "These details were already sent. Thank you!");
  if (status === "expired") throw new HttpError(410, "expired", "This link has expired. Please call or text the business.");

  const stored = await storePhotos(request.tenantId, photos);
  await tenantWork(request.tenantId, (tx, fx) =>
    recordSubmission(
      tx,
      fx,
      { tenantId: request.tenantId, leadId: request.leadId, customerId: request.customerId, requestId: request.id },
      fields,
      stored,
      meta,
      `${fields.contactName} sent job details`,
    ),
  );
  return { ok: true as const, photos: stored.length };
}

/** Sends from one device per hour, per business, before the form asks them to call instead. */
const REQUESTS_PER_HOUR = 5;
const recentRequests = new Map<string, number[]>();

/**
 * A new request from the public form (C-10): the website button, the Google profile link
 * or a shared link. It becomes a lead like a missed call does, then the same intake steps run.
 */
export async function submitPublicRequest(
  slug: string,
  fields: z.output<typeof publicRequestFields>,
  photos: UploadedPhoto[],
  meta: { ipAddress: string | null },
) {
  const tenant = await tenantBySlug(slug);
  // Only bots fill in the hidden field: tell them it worked and keep nothing.
  if (fields.company) return { ok: true as const, photos: 0 };

  const key = `${tenant.id}:${meta.ipAddress ?? "unknown"}`;
  const now = Date.now();
  const recent = (recentRequests.get(key) ?? []).filter((at) => now - at < 3_600_000);
  if (recent.length >= REQUESTS_PER_HOUR) {
    throw new HttpError(429, "too_many_requests", `You've sent several requests already. Please call ${tenant.name} instead.`);
  }
  if (recentRequests.size > 10_000) recentRequests.clear();
  recentRequests.set(key, [...recent, now]);

  const stored = await storePhotos(tenant.id, photos);
  await tenantWork(tenant.id, async (tx, fx) => {
    const { lead } = await captureLead(tx, fx, {
      tenant,
      phoneE164: fields.phone,
      customerName: fields.contactName,
      source: fields.source === "google" ? "google" : "web_form",
      title: fields.details.length > 60 ? `${fields.details.slice(0, 59).trimEnd()}…` : fields.details,
      needsCallback: true,
      event: { type: "request.received", data: { channel: fields.source } },
    });
    // A request link that is already used: the same record as one the owner texted, so both paths look alike.
    const [request] = await tx
      .insert(intakeRequests)
      .values({ tenantId: tenant.id, leadId: lead.id, customerId: lead.customerId, tokenHash: sha256(randomToken()), expiresAt: new Date() })
      .returning({ id: intakeRequests.id });
    await recordSubmission(
      tx,
      fx,
      { tenantId: tenant.id, leadId: lead.id, customerId: lead.customerId, requestId: request!.id },
      fields,
      stored,
      meta,
      `New request from ${SOURCE_PHRASE[fields.source]}: ${fields.contactName}`,
    );
    if (fields.campaign) await creditCampaign(tx, { tenant, token: fields.campaign, leadId: lead.id, via: "request" });
  });
  return { ok: true as const, photos: stored.length };
}

/** Saves a sent form on its lead: photos, answers, the consent boxes, the owner's alert and AI triage. */
async function recordSubmission(
  tx: Tx,
  fx: Effects,
  target: { tenantId: string; leadId: string; customerId: string; requestId: string },
  fields: SubmitFields,
  stored: StoredPhoto[],
  meta: { ipAddress: string | null },
  alertTitle: string,
) {
  const [service] = fields.serviceId ? await tx.select({ name: services.name }).from(services).where(eq(services.id, fields.serviceId)).limit(1) : [];

  for (const item of stored) {
    await tx.insert(mediaAssets).values({
      id: item.id,
      tenantId: target.tenantId,
      leadId: target.leadId,
      kind: "photo",
      storageKey: item.storageKey,
      thumbKey: item.thumbKey,
      mimeType: item.processed.mimeType,
      sizeBytes: item.processed.data.length,
      width: item.processed.width,
      height: item.processed.height,
      sha256: item.processed.sha256,
    });
    fx.enqueue(QUEUES.triagePhoto, { tenantId: target.tenantId, mediaId: item.id });
  }

  const submission = {
    service: service?.name ?? null,
    details: fields.details,
    contactName: fields.contactName,
    address: fields.address || null,
    preferredTime: fields.preferredTime || null,
    photoCount: stored.length,
  };

  await tx.update(intakeRequests).set({ status: "submitted", submittedAt: new Date(), submission }).where(eq(intakeRequests.id, target.requestId));

  const [customer] = await tx
    .update(customers)
    .set({ name: fields.contactName, ...(fields.address ? { address: fields.address } : {}), ...(fields.email ? { email: fields.email } : {}) })
    .where(eq(customers.id, target.customerId))
    .returning();

  await tx
    .update(leads)
    .set({ intakeStatus: "submitted", ...(service ? { serviceCategory: service.name } : {}) })
    .where(eq(leads.id, target.leadId));

  await addLeadEvent(tx, { tenantId: target.tenantId, leadId: target.leadId, type: "intake.submitted", actor: "customer", data: submission });

  // C-27: two separate boxes, two separate ledger entries — job texts and (optional) marketing texts.
  const ticked = [
    fields.smsConsent && { type: "sms_transactional" as const, version: INTAKE_CONSENT_VERSION, text: () => INTAKE_CONSENT_TEXT },
    fields.marketingConsent && {
      type: "sms_marketing" as const,
      version: INTAKE_MARKETING_CONSENT_VERSION,
      text: (businessName: string) => intakeMarketingConsentText(businessName),
    },
  ].filter((box) => box !== false);
  if (ticked.length > 0 && customer?.phoneE164) {
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, target.tenantId));
    const businessName = tenant?.name ?? "business";
    for (const box of ticked) {
      await consentLedger.record(
        {
          tenantId: target.tenantId,
          phoneE164: customer.phoneE164,
          type: box.type,
          action: "GRANTED",
          source: "web_form",
          textVersion: box.version,
          evidence: `Ticked: "${box.text(businessName)}"`,
          ipAddress: meta.ipAddress,
          grantedTo: `${businessName} (${target.tenantId})`,
        },
        tx,
      );
      await addLeadEvent(tx, {
        tenantId: target.tenantId,
        leadId: target.leadId,
        type: "consent.granted",
        actor: "customer",
        data: { channel: "sms", type: box.type, source: "web_form", textVersion: box.version, answer: "Ticked the box" },
      });
    }
  }

  await notifyOwner(tx, fx, {
    tenantId: target.tenantId,
    kind: "intake_submitted",
    title: alertTitle,
    body: [service?.name, fields.details].filter(Boolean).join(" — ").slice(0, 140),
    leadId: target.leadId,
    callbackPhone: customer?.phoneE164 ?? null,
  });

  fx.enqueue(QUEUES.extractCallerNeed, {
    tenantId: target.tenantId,
    leadId: target.leadId,
    callId: null,
    source: "web_form",
    transcript: [
      service ? `Service picked: ${service.name}.` : "",
      `Details: ${fields.details}`,
      fields.preferredTime ? `Preferred time: ${fields.preferredTime}` : "",
      `Name: ${fields.contactName}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  fx.publish({ type: "lead.updated", leadId: target.leadId });
}
