import {
  INTAKE_CONSENT_TEXT,
  INTAKE_CONSENT_VERSION,
  INTAKE_MARKETING_CONSENT_VERSION,
  type IntakeContext,
  intakeMarketingConsentText,
  type intakeSubmitFields,
} from "@leadanchor/contracts";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import { uuidv7 } from "uuidv7";
import { linkBaseUrl } from "../../config/env";
import { systemDb, type Tx } from "../../db/client";
import { customers, intakeRequests, leads, mediaAssets, phoneNumbers, services, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { QUEUES } from "../../jobs/queue";
import { randomToken, sha256 } from "../../lib/crypto";
import { HttpError, notFound } from "../../lib/errors";
import { addDays } from "../../lib/time";
import { consentLedger, storage } from "../../container";
import { addLeadEvent } from "../leads/lead-capture";
import { notifyOwner } from "../notifications/notify";
import { type ProcessedPhoto, processPhoto } from "./photo";

const LINK_TTL_DAYS = 7;
export const MAX_PHOTOS = 5;

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

const statusOf = (request: typeof intakeRequests.$inferSelect): IntakeContext["status"] =>
  request.status === "submitted" ? "submitted" : request.expiresAt < new Date() ? "expired" : "open";

export async function getIntakeContext(token: string): Promise<IntakeContext> {
  const request = await resolve(token);

  return tenantWork(request.tenantId, async (tx, fx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, request.tenantId));
    const serviceRows = await tx
      .select({ id: services.id, name: services.name, description: services.description })
      .from(services)
      .where(and(eq(services.tenantId, request.tenantId), eq(services.active, true)))
      .orderBy(asc(services.sortOrder));
    const [customer] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, request.customerId));
    const [number] = await tx.select({ e164: phoneNumbers.e164 }).from(phoneNumbers).where(eq(phoneNumbers.tenantId, request.tenantId)).limit(1);

    const status = statusOf(request);
    if (status === "open" && request.status === "sent") {
      await tx.update(intakeRequests).set({ status: "opened", openedAt: new Date() }).where(eq(intakeRequests.id, request.id));
      await tx.update(leads).set({ intakeStatus: "opened" }).where(and(eq(leads.id, request.leadId), eq(leads.intakeStatus, "link_sent")));
      await addLeadEvent(tx, { tenantId: request.tenantId, leadId: request.leadId, type: "intake.opened", actor: "customer" });
      fx.publish({ type: "lead.updated", leadId: request.leadId });
    }

    return {
      business: {
        name: tenant!.name,
        trade: tenant!.trade,
        city: tenant!.city,
        state: tenant!.state,
        licenseNumber: tenant!.licenseNumber,
        insured: Boolean(tenant!.insuranceCarrier),
        yearsInBusiness: tenant!.yearsInBusiness,
        phone: number?.e164 ?? null,
      },
      services: serviceRows,
      customerName: customer?.name ?? null,
      status,
    };
  });
}

export interface UploadedPhoto {
  buffer: Buffer;
}

/** Stores the customer's answers and photos, then queues AI triage (C-08, C-09). */
export async function submitIntake(
  token: string,
  fields: z.output<typeof intakeSubmitFields>,
  photos: UploadedPhoto[],
  meta: { ipAddress: string | null } = { ipAddress: null },
) {
  const request = await resolve(token);
  const status = statusOf(request);
  if (status === "submitted") throw new HttpError(409, "already_submitted", "These details were already sent. Thank you!");
  if (status === "expired") throw new HttpError(410, "expired", "This link has expired. Please call or text the business.");

  // Process and store photos before opening the transaction.
  const stored: Array<{ id: string; storageKey: string; thumbKey: string; processed: ProcessedPhoto }> = [];
  for (const photo of photos.slice(0, MAX_PHOTOS)) {
    const processed = await processPhoto(photo.buffer);
    const id = uuidv7();
    const month = new Date().toISOString().slice(0, 7);
    const storageKey = `${request.tenantId}/${month}/${id}.webp`;
    const thumbKey = `${request.tenantId}/${month}/${id}.thumb.webp`;
    await storage.put(storageKey, processed.data);
    await storage.put(thumbKey, processed.thumb);
    stored.push({ id, storageKey, thumbKey, processed });
  }

  await tenantWork(request.tenantId, async (tx, fx) => {
    const [service] = fields.serviceId
      ? await tx.select({ name: services.name }).from(services).where(eq(services.id, fields.serviceId)).limit(1)
      : [];

    for (const item of stored) {
      await tx.insert(mediaAssets).values({
        id: item.id,
        tenantId: request.tenantId,
        leadId: request.leadId,
        kind: "photo",
        storageKey: item.storageKey,
        thumbKey: item.thumbKey,
        mimeType: item.processed.mimeType,
        sizeBytes: item.processed.data.length,
        width: item.processed.width,
        height: item.processed.height,
        sha256: item.processed.sha256,
      });
      fx.enqueue(QUEUES.triagePhoto, { tenantId: request.tenantId, mediaId: item.id });
    }

    const submission = {
      service: service?.name ?? null,
      details: fields.details,
      contactName: fields.contactName,
      address: fields.address || null,
      preferredTime: fields.preferredTime || null,
      photoCount: stored.length,
    };

    await tx
      .update(intakeRequests)
      .set({ status: "submitted", submittedAt: new Date(), submission })
      .where(eq(intakeRequests.id, request.id));

    await tx
      .update(customers)
      .set({ name: fields.contactName, ...(fields.address ? { address: fields.address } : {}), ...(fields.email ? { email: fields.email } : {}) })
      .where(eq(customers.id, request.customerId));

    await tx
      .update(leads)
      .set({ intakeStatus: "submitted", ...(service ? { serviceCategory: service.name } : {}) })
      .where(eq(leads.id, request.leadId));

    await addLeadEvent(tx, { tenantId: request.tenantId, leadId: request.leadId, type: "intake.submitted", actor: "customer", data: submission });

    // C-27: two separate boxes, two separate ledger entries — job texts and (optional) marketing texts.
    const ticked = [
      fields.smsConsent && { type: "sms_transactional" as const, version: INTAKE_CONSENT_VERSION, text: () => INTAKE_CONSENT_TEXT },
      fields.marketingConsent && {
        type: "sms_marketing" as const,
        version: INTAKE_MARKETING_CONSENT_VERSION,
        text: (businessName: string) => intakeMarketingConsentText(businessName),
      },
    ].filter((box) => box !== false);
    if (ticked.length > 0) {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, request.customerId));
      if (customer?.phoneE164) {
        const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, request.tenantId));
        const businessName = tenant?.name ?? "business";
        for (const box of ticked) {
          await consentLedger.record(
            {
              tenantId: request.tenantId,
              phoneE164: customer.phoneE164,
              type: box.type,
              action: "GRANTED",
              source: "web_form",
              textVersion: box.version,
              evidence: `Ticked: "${box.text(businessName)}"`,
              ipAddress: meta.ipAddress,
              grantedTo: `${businessName} (${request.tenantId})`,
            },
            tx,
          );
          await addLeadEvent(tx, {
            tenantId: request.tenantId,
            leadId: request.leadId,
            type: "consent.granted",
            actor: "customer",
            data: { channel: "sms", type: box.type, source: "web_form", textVersion: box.version, answer: "Ticked the box" },
          });
        }
      }
    }

    await notifyOwner(tx, fx, {
      tenantId: request.tenantId,
      kind: "intake_submitted",
      title: `${fields.contactName} sent job details`,
      body: [service?.name, fields.details].filter(Boolean).join(" — ").slice(0, 140),
      leadId: request.leadId,
    });

    fx.enqueue(QUEUES.extractCallerNeed, {
      tenantId: request.tenantId,
      leadId: request.leadId,
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

    fx.publish({ type: "lead.updated", leadId: request.leadId });
  });

  return { ok: true as const, photos: stored.length };
}
