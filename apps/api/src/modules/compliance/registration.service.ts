import {
  REGISTRATION_ID_RETENTION_DAYS,
  REGISTRATION_STATUS_COPY,
  type RegistrationResponse,
  type RegistrationStage,
  type RegistrationStatus,
  type RegistryTestOutcome,
  registrationInput,
} from "@leadanchor/contracts";
import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { z } from "zod";
import { env } from "../../config/env";
import { systemDb, type Tx, withTenant } from "../../db/client";
import { carrierRegistrations, phoneNumbers, tenants } from "../../db/schema";
import { type Effects, tenantWork } from "../../db/unit-of-work";
import { QUEUES, enqueue } from "../../jobs/queue";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { HttpError } from "../../lib/errors";
import { addDays, iso } from "../../lib/time";
import { registry, simulatorRegistry } from "../../container";
import { type BrandSubmission, RegistryRejection } from "../../integrations/registry/types";
import { notifyOwner } from "../notifications/notify";
import { audit } from "./audit";
import { TRADE_VERTICAL, campaignContent, plainFailure } from "./registration-copy";

type RegistrationData = z.output<typeof registrationInput>;
type Registration = typeof carrierRegistrations.$inferSelect;

/** Non-sensitive submission details. The EIN and date of birth live in their own encrypted columns. */
interface RegistrationDetails {
  entityType?: "PRIVATE_PROFIT" | "PUBLIC_PROFIT" | "NON_PROFIT";
  website?: string | null;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  firstName?: string;
  lastName?: string;
  mobile?: string;
  email?: string;
  address?: { street: string; city: string; state: string; postalCode: string };
  testOutcome?: RegistryTestOutcome;
}

/** How soon a sole proprietor may ask for another code. */
const RESEND_CODE_AFTER_MS = 60_000;

/**
 * Carrier registration (A2P 10DLC, C-43). Two auto-routed paths: businesses with
 * an EIN register a Standard brand; sole proprietors without one use their personal
 * details plus a code texted to their mobile. Then a texting campaign is filed and the
 * LeadAnchor number attached to it. Tax IDs and dates of birth are encrypted at rest,
 * only ever shown masked, and deleted 30 days after approval. Outbound SMS stays
 * hard-blocked until the carriers approve (see approvedForTexting).
 */
export async function getRegistration(tenantId: string): Promise<RegistrationResponse> {
  const [row] = await withTenant(tenantId, (tx) => tx.select().from(carrierRegistrations).where(eq(carrierRegistrations.tenantId, tenantId)));
  return present(row ?? null);
}

/** Texts may go out only on an approval from the registry we text through, never a leftover simulated one. */
export function approvedForTexting(row: { status: RegistrationStatus; provider: string | null }) {
  return row.status === "approved" && !fromOtherRegistry(row);
}

/** Filed with a different registry: the simulator, before Telnyx was connected. Rows from before `provider` existed were simulated. */
function fromOtherRegistry(row: { status: RegistrationStatus; provider: string | null }) {
  return row.status !== "not_started" && (row.provider ?? "simulator") !== registry.name;
}

function present(row: Registration | null): RegistrationResponse {
  const details = (row?.details ?? {}) as RegistrationDetails;
  const stale = row !== null && fromOtherRegistry(row);
  const status: RegistrationStatus = stale ? "rejected" : (row?.status ?? "not_started");
  const stage: RegistrationStage | null = stale ? "brand" : status === "not_started" || status === "approved" ? null : (row?.stage ?? "brand");
  const holdsId = Boolean(row?.taxIdEncrypted || row?.dateOfBirthEncrypted);
  return {
    path: row?.path ?? null,
    status,
    statusCopy: REGISTRATION_STATUS_COPY[status],
    stage,
    statusReason: stale
      ? "This registration was made on the test simulator. Send your details again to register with the carriers."
      : status === "rejected"
        ? (row?.statusReason ?? null)
        : null,
    displayName: row?.displayName ?? null,
    maskedTaxId: row?.taxIdLast4 ? `••-•••${row.taxIdLast4}` : row?.path === "sole_proprietor" ? "No EIN — sole proprietor" : null,
    mobileLast4: row?.path === "sole_proprietor" && details.mobile ? details.mobile.slice(-4) : null,
    submittedAt: iso(row?.submittedAt),
    approvedAt: iso(row?.approvedAt),
    idDeletedAt: iso(row?.idPurgedAt),
    idDeleteAfter: row?.approvedAt && holdsId && status === "approved" ? addDays(row.approvedAt, REGISTRATION_ID_RETENTION_DAYS).toISOString() : null,
    smsEnabled: row !== null && approvedForTexting(row),
    simulated: registry.name === "simulator",
    prefill: row && status === "rejected" && stage === "brand" ? prefill(row, details) : null,
  };
}

function prefill(row: Registration, details: RegistrationDetails): Record<string, string> {
  const address = details.address ?? { street: "", city: "", state: "", postalCode: "" };
  const shared = { street: address.street, city: address.city, state: address.state, postalCode: address.postalCode };
  return row.path === "standard"
    ? {
        legalName: row.displayName,
        entityType: details.entityType ?? "PRIVATE_PROFIT",
        website: details.website ?? "",
        contactName: details.contactName ?? "",
        contactEmail: details.contactEmail ?? "",
        contactPhone: details.contactPhone ?? "",
        ...shared,
      }
    : { firstName: details.firstName ?? "", lastName: details.lastName ?? "", mobile: details.mobile ?? "", email: details.email ?? "", ...shared };
}

export async function submitRegistration(tenantId: string, userId: string, input: RegistrationData) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [existing] = await tx.select().from(carrierRegistrations).where(eq(carrierRegistrations.tenantId, tenantId)).for("update");
    const stale = existing !== undefined && fromOtherRegistry(existing);
    if (existing && !stale && existing.status !== "not_started" && existing.status !== "rejected") {
      throw new HttpError(409, "registration_in_progress", "Your registration is already with the carriers.");
    }

    const address = { street: input.street, city: input.city, state: input.state.toUpperCase(), postalCode: input.postalCode };
    const testOutcome = registry.name === "simulator" ? input.simulate : undefined;
    const identity =
      input.path === "standard"
        ? {
            displayName: input.legalName,
            taxIdEncrypted: encryptSecret(input.ein.replace(/^(\d{2})-?(\d{7})$/, "$1-$2")),
            taxIdLast4: input.ein.slice(-4),
            dateOfBirthEncrypted: null,
            details: {
              entityType: input.entityType,
              website: input.website || null,
              contactName: input.contactName,
              contactEmail: input.contactEmail,
              contactPhone: input.contactPhone,
              address,
              testOutcome,
            } satisfies RegistrationDetails,
          }
        : {
            displayName: `${input.firstName} ${input.lastName}`,
            taxIdEncrypted: null,
            taxIdLast4: null,
            dateOfBirthEncrypted: encryptSecret(input.dateOfBirth),
            details: { firstName: input.firstName, lastName: input.lastName, mobile: input.mobile, email: input.email, address, testOutcome } satisfies RegistrationDetails,
          };

    // A turned-down brand is corrected in place on the registry that holds it; anything else is filed fresh.
    const keepBrand = Boolean(existing?.providerBrandId) && !stale && existing?.path === input.path;
    const values = {
      path: input.path,
      ...identity,
      status: "submitted" as const,
      stage: "brand" as const,
      statusReason: null,
      provider: keepBrand ? existing!.provider : null,
      providerBrandId: keepBrand ? existing!.providerBrandId : null,
      providerCampaignId: null,
      submittedAt: new Date(),
      otpSentAt: null,
      otpVerifiedAt: null,
      approvedAt: null,
      idPurgedAt: null,
    };
    if (existing) {
      await tx.update(carrierRegistrations).set(values).where(eq(carrierRegistrations.id, existing.id));
    } else {
      await tx.insert(carrierRegistrations).values({ tenantId, ...values });
    }

    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "registration.submitted",
      entityType: "carrier_registration",
      data: { path: input.path, resubmission: Boolean(existing && existing.status !== "not_started") },
    });
    fx.publish({ type: "registration.updated" });
    fx.enqueue(QUEUES.registrationAdvance, { tenantId });
  });
  return getRegistration(tenantId);
}

/**
 * Moves a registration one step through the carriers' review: file the brand, then
 * the campaign, then attach the number. Runs right after each owner action, every
 * 15 minutes while the carriers are reviewing, and every few seconds on the simulator.
 */
export async function advanceRegistrationJob({ tenantId }: { tenantId: string }) {
  const status = await tenantWork(tenantId, async (tx, fx) => {
    // One step at a time per business: a second job finds the row locked and leaves it.
    const [row] = await tx
      .select()
      .from(carrierRegistrations)
      .where(eq(carrierRegistrations.tenantId, tenantId))
      .for("update", { skipLocked: true });
    if (!row || (row.status !== "submitted" && row.status !== "in_review") || fromOtherRegistry(row)) return null;
    return step(tx, fx, row);
  });
  // The pretend carriers answer in seconds, so look again soon; real reviews wait for the 15-minute tick.
  if (registry.name === "simulator" && (status === "submitted" || status === "in_review")) {
    await enqueue(QUEUES.registrationAdvance, { tenantId }, { startAfterSecs: 5 });
  }
}

async function step(tx: Tx, fx: Effects, row: Registration): Promise<RegistrationStatus> {
  const details = row.details as RegistrationDetails;
  const [tenant] = await tx.select({ name: tenants.name, trade: tenants.trade }).from(tenants).where(eq(tenants.id, row.tenantId));
  const businessName = tenant?.name ?? row.displayName;
  const now = new Date();
  const save = (values: Partial<typeof carrierRegistrations.$inferInsert>) =>
    tx.update(carrierRegistrations).set({ lastCheckedAt: now, ...values }).where(eq(carrierRegistrations.id, row.id));
  const moved = async (values: Partial<typeof carrierRegistrations.$inferInsert>, status: RegistrationStatus) => {
    await save(values);
    fx.publish({ type: "registration.updated" });
    return status;
  };

  if (row.status === "submitted" || !row.providerBrandId) {
    try {
      const brand = brandSubmission(row, details, businessName, tenant?.trade ? TRADE_VERTICAL[tenant.trade] : "PROFESSIONAL");
      const { brandId } = await registry.submitBrand(brand, row.providerBrandId);
      if (row.path === "sole_proprietor") {
        await registry.sendOtp(brandId, businessName);
        return moved({ provider: registry.name, providerBrandId: brandId, status: "verify_mobile", stage: "brand", otpSentAt: now }, "verify_mobile");
      }
      return moved({ provider: registry.name, providerBrandId: brandId, status: "in_review", stage: "brand" }, "in_review");
    } catch (error) {
      if (error instanceof RegistryRejection) return reject(tx, fx, row, "brand", error.reason);
      throw error;
    }
  }

  const stage = row.stage ?? "brand";
  if (stage === "brand") {
    const review = await registry.brandStatus(row.providerBrandId);
    if (review.state === "failed") return reject(tx, fx, row, "brand", review.reason);
    if (review.state === "pending") return save({}).then(() => row.status);
    try {
      const content = campaignContent({ businessName, path: row.path, webUrl: env.PUBLIC_WEB_URL });
      const { campaignId } = await registry.createCampaign({ brandId: row.providerBrandId, path: row.path, ...content, testOutcome: details.testOutcome });
      return moved({ stage: "campaign", providerCampaignId: campaignId }, "in_review");
    } catch (error) {
      if (error instanceof RegistryRejection) return reject(tx, fx, row, "campaign", error.reason);
      throw error;
    }
  }

  const number = await trackingNumber(tx, row.tenantId);
  if (!row.providerCampaignId || !number) return save({}).then(() => row.status);

  if (stage === "campaign") {
    const review = await registry.campaignStatus(row.providerCampaignId);
    if (review.state === "failed") return reject(tx, fx, row, "campaign", review.reason);
    if (review.state === "pending") return save({}).then(() => row.status);
    await registry.assignNumber(row.providerCampaignId, number);
    return moved({ stage: "number" }, "in_review");
  }

  const review = await registry.numberStatus(number);
  if (review.state === "failed") return reject(tx, fx, row, "number", review.reason);
  if (review.state === "pending") return save({}).then(() => row.status);
  return approve(tx, fx, row, businessName);
}

function brandSubmission(row: Registration, details: RegistrationDetails, businessName: string, vertical: string): BrandSubmission {
  const address = details.address ?? { street: "", city: "", state: "", postalCode: "" };
  const shared = { displayName: businessName, ...address, vertical, testOutcome: details.testOutcome };
  if (row.path === "standard") {
    return {
      path: "standard",
      entityType: details.entityType ?? "PRIVATE_PROFIT",
      companyName: row.displayName,
      ein: row.taxIdEncrypted ? decryptSecret(row.taxIdEncrypted) : null,
      firstName: null,
      lastName: null,
      mobilePhone: null,
      phone: details.contactPhone ?? "",
      email: details.contactEmail ?? "",
      website: details.website ?? null,
      ...shared,
    };
  }
  return {
    path: "sole_proprietor",
    entityType: "SOLE_PROPRIETOR",
    companyName: null,
    ein: null,
    firstName: details.firstName ?? row.displayName.split(" ")[0] ?? "",
    lastName: details.lastName ?? row.displayName.split(" ").slice(1).join(" "),
    mobilePhone: details.mobile ?? null,
    phone: details.mobile ?? "",
    email: details.email ?? "",
    website: null,
    ...shared,
  };
}

async function trackingNumber(tx: Tx, tenantId: string) {
  const [number] = await tx
    .select({ e164: phoneNumbers.e164 })
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "active")))
    .limit(1);
  return number?.e164 ?? null;
}

async function reject(tx: Tx, fx: Effects, row: Registration, stage: RegistrationStage, raw: string | null): Promise<RegistrationStatus> {
  const reason = plainFailure(stage, raw);
  await tx
    .update(carrierRegistrations)
    .set({ status: "rejected", stage, statusReason: reason, lastCheckedAt: new Date() })
    .where(eq(carrierRegistrations.id, row.id));
  await audit(tx, {
    tenantId: row.tenantId,
    actor: `registry:${registry.name}`,
    action: "registration.rejected",
    entityType: "carrier_registration",
    entityId: row.id,
    data: { stage, reason: raw },
  });
  await notifyOwner(tx, fx, { tenantId: row.tenantId, kind: "registration", title: "Carrier registration needs a fix", body: reason });
  fx.publish({ type: "registration.updated" });
  return "rejected";
}

async function approve(tx: Tx, fx: Effects, row: Registration, businessName: string): Promise<RegistrationStatus> {
  const now = new Date();
  await tx
    .update(carrierRegistrations)
    .set({ status: "approved", stage: null, statusReason: null, approvedAt: now, lastCheckedAt: now })
    .where(eq(carrierRegistrations.id, row.id));
  await audit(tx, { tenantId: row.tenantId, actor: `registry:${registry.name}`, action: "registration.approved", entityType: "carrier_registration", entityId: row.id });
  await notifyOwner(tx, fx, {
    tenantId: row.tenantId,
    kind: "registration",
    title: "You're approved to text customers",
    body: `US carriers approved ${businessName}. Automatic texts are on from now.`,
  });
  fx.publish({ type: "registration.updated" });
  return "approved";
}

/** Sole proprietors: the code the carriers texted to their mobile (C-43 AC 3). */
export async function confirmRegistrationCode(tenantId: string, userId: string, code: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    const row = await awaitingCode(tx, tenantId);
    if (!(await registry.verifyOtp(row.providerBrandId!, code))) {
      throw new HttpError(422, "validation_failed", "That code doesn't match.", {
        code: ["That code doesn't match. Check the latest text, or send a new code."],
      });
    }
    await tx.update(carrierRegistrations).set({ status: "in_review", stage: "brand", otpVerifiedAt: new Date() }).where(eq(carrierRegistrations.id, row.id));
    await audit(tx, { tenantId, actor: `user:${userId}`, action: "registration.mobile_confirmed", entityType: "carrier_registration", entityId: row.id });
    fx.publish({ type: "registration.updated" });
    fx.enqueue(QUEUES.registrationAdvance, { tenantId });
  });
  return getRegistration(tenantId);
}

export async function resendRegistrationCode(tenantId: string, userId: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    const row = await awaitingCode(tx, tenantId);
    if (row.otpSentAt && Date.now() - row.otpSentAt.getTime() < RESEND_CODE_AFTER_MS) {
      throw new HttpError(429, "too_soon", "A code was just sent. Give it a minute before asking for another.");
    }
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
    await registry.sendOtp(row.providerBrandId!, tenant?.name ?? row.displayName);
    await tx.update(carrierRegistrations).set({ otpSentAt: new Date() }).where(eq(carrierRegistrations.id, row.id));
    await audit(tx, { tenantId, actor: `user:${userId}`, action: "registration.code_resent", entityType: "carrier_registration", entityId: row.id });
    fx.publish({ type: "registration.updated" });
  });
  return getRegistration(tenantId);
}

async function awaitingCode(tx: Tx, tenantId: string) {
  const [row] = await tx.select().from(carrierRegistrations).where(eq(carrierRegistrations.tenantId, tenantId)).for("update");
  if (!row || row.status !== "verify_mobile" || !row.providerBrandId || fromOtherRegistry(row)) {
    throw new HttpError(409, "no_code_pending", "There's no code to confirm right now.");
  }
  return row;
}

/** After the texting plan or the number hookup was turned down: file it again, keeping the approved business check. */
export async function retryRegistration(tenantId: string, userId: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [row] = await tx.select().from(carrierRegistrations).where(eq(carrierRegistrations.tenantId, tenantId)).for("update");
    if (!row || row.status !== "rejected" || row.stage === "brand" || fromOtherRegistry(row)) {
      throw new HttpError(409, "nothing_to_retry", "Correct your business details and send them again.");
    }
    // The simulator's planned "no" was for the first try.
    const { testOutcome: _planned, ...details } = row.details as RegistrationDetails;
    await tx
      .update(carrierRegistrations)
      .set({
        status: "in_review",
        statusReason: null,
        details,
        // A turned-down plan is filed fresh from the approved business; a failed hookup retries the approved plan.
        stage: row.stage === "campaign" ? "brand" : "campaign",
        providerCampaignId: row.stage === "campaign" ? null : row.providerCampaignId,
      })
      .where(eq(carrierRegistrations.id, row.id));
    await audit(tx, { tenantId, actor: `user:${userId}`, action: "registration.retried", entityType: "carrier_registration", entityId: row.id, data: { stage: row.stage } });
    fx.publish({ type: "registration.updated" });
    fx.enqueue(QUEUES.registrationAdvance, { tenantId });
  });
  return getRegistration(tenantId);
}

/** Every 15 minutes: check on registrations the carriers are reviewing, and apply the ID retention rule. */
export async function registrationTickJob() {
  const reviewing = await systemDb
    .select({ tenantId: carrierRegistrations.tenantId })
    .from(carrierRegistrations)
    .where(inArray(carrierRegistrations.status, ["submitted", "in_review"]));
  for (const { tenantId } of reviewing) await enqueue(QUEUES.registrationAdvance, { tenantId });
  await deleteExpiredIds(new Date());
}

/** Retention (C-43 AC 6): the full EIN and date of birth go 30 days after approval; the last 4 digits stay. */
export async function deleteExpiredIds(now: Date) {
  const due = await systemDb
    .select({ id: carrierRegistrations.id, tenantId: carrierRegistrations.tenantId })
    .from(carrierRegistrations)
    .where(
      and(
        eq(carrierRegistrations.status, "approved"),
        lt(carrierRegistrations.approvedAt, addDays(now, -REGISTRATION_ID_RETENTION_DAYS)),
        isNull(carrierRegistrations.idPurgedAt),
        or(isNotNull(carrierRegistrations.taxIdEncrypted), isNotNull(carrierRegistrations.dateOfBirthEncrypted)),
      ),
    );
  for (const row of due) {
    await tenantWork(row.tenantId, async (tx) => {
      await tx
        .update(carrierRegistrations)
        .set({ taxIdEncrypted: null, dateOfBirthEncrypted: null, idPurgedAt: now })
        .where(eq(carrierRegistrations.id, row.id));
      await audit(tx, { tenantId: row.tenantId, actor: "system:retention", action: "registration.ids_deleted", entityType: "carrier_registration", entityId: row.id });
    });
  }
  return due.length;
}

/** Development only: pretend the carriers approved the business right away. */
export async function approveRegistrationForDev(tenantId: string, userId: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [existing] = await tx.select().from(carrierRegistrations).where(eq(carrierRegistrations.tenantId, tenantId));
    const now = new Date();
    const approved = { status: "approved" as const, provider: "simulator", stage: null, statusReason: null, approvedAt: now };
    if (existing) {
      await tx.update(carrierRegistrations).set(approved).where(eq(carrierRegistrations.id, existing.id));
    } else {
      await tx.insert(carrierRegistrations).values({ tenantId, path: "standard", displayName: "Simulated registration", submittedAt: now, ...approved });
    }
    await audit(tx, { tenantId, actor: `user:${userId}`, action: "registration.approved_simulated", entityType: "carrier_registration" });
    fx.publish({ type: "registration.updated" });
  });
  return getRegistration(tenantId);
}

/** Development only: forget the registration so the whole flow can be tried again. Texting turns off. */
export async function resetRegistrationForDev(tenantId: string, userId: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    await tx.delete(carrierRegistrations).where(eq(carrierRegistrations.tenantId, tenantId));
    await audit(tx, { tenantId, actor: `user:${userId}`, action: "registration.reset_simulated", entityType: "carrier_registration" });
    fx.publish({ type: "registration.updated" });
  });
  return getRegistration(tenantId);
}

/** Development only: the code the pretend carriers "texted", shown in the simulator box. */
export async function simulatedRegistrationCode(tenantId: string) {
  const [row] = await withTenant(tenantId, (tx) => tx.select().from(carrierRegistrations).where(eq(carrierRegistrations.tenantId, tenantId)));
  if (registry.name !== "simulator" || row?.status !== "verify_mobile" || !row.providerBrandId) return null;
  return simulatorRegistry.otpFor(row.providerBrandId);
}
