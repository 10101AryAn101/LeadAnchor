import {
  REGISTRATION_STATUSES,
  type OnboardingInput,
  type SettingsResponse,
  type SettingsUpdateInput,
  TRACK_BY_TRADE,
  type TenantSummary,
  onboardingInput,
} from "@leadanchor/contracts";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { z } from "zod";
import { systemDb, withTenant } from "../../db/client";
import { carrierRegistrations, memberships, phoneNumbers, services, tenants } from "../../db/schema";
import { HttpError } from "../../lib/errors";
import { telephony } from "../../container";
import { audit } from "../compliance/audit";
import { DEFAULT_SERVICES } from "./default-services";

type OnboardingData = z.output<typeof onboardingInput>;

export async function findMembership(userId: string) {
  const [row] = await systemDb.select().from(memberships).where(eq(memberships.userId, userId)).limit(1);
  return row ?? null;
}

/** Creates the business, makes the user its owner, provisions its number (C-02) and seeds its catalogue (C-17). */
export async function onboardTenant(userId: string, input: OnboardingData) {
  if (await findMembership(userId)) throw new HttpError(409, "already_onboarded", "Your business is already set up.");

  const areaCode = input.ownerCell.slice(2, 5);
  const number = await telephony.provisionNumber({ areaCode });
  const tenantId = uuidv7();
  const slug = `${slugify(input.businessName)}-${tenantId.slice(-4)}`;

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: input.businessName,
      slug,
      trade: input.trade,
      track: TRACK_BY_TRADE[input.trade],
      timezone: input.timezone,
      ownerName: input.ownerName,
      ownerCellE164: input.ownerCell,
      city: input.city || null,
      state: input.state ? input.state.toUpperCase() : null,
      avgJobValueCents: input.avgJobValueDollars * 100,
      onboardedAt: new Date(),
    });
    await tx.insert(memberships).values({ tenantId, userId, role: "owner" });
    await tx.insert(phoneNumbers).values({
      tenantId,
      e164: number.e164,
      provider: telephony.name,
      providerNumberId: number.providerNumberId,
    });
    await tx.insert(services).values(DEFAULT_SERVICES[input.trade].map((name, index) => ({ tenantId, name, sortOrder: index })));
    await audit(tx, { tenantId, actor: `user:${userId}`, action: "tenant.created", entityType: "tenant", entityId: tenantId, data: { trade: input.trade, number: number.e164 } });
  });

  return tenantId;
}

export async function getTenantSummary(tenantId: string): Promise<TenantSummary> {
  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [number] = await tx
      .select({ e164: phoneNumbers.e164 })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "active")))
      .limit(1);
    const [registration] = await tx.select({ status: carrierRegistrations.status }).from(carrierRegistrations).limit(1);
    if (!tenant) throw new HttpError(404, "not_found", "Business not found.");
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      trade: tenant.trade,
      track: tenant.track,
      timezone: tenant.timezone,
      trackingNumber: number?.e164 ?? null,
      ownerCell: tenant.ownerCellE164,
      registrationStatus: registration?.status ?? REGISTRATION_STATUSES[0],
    };
  });
}

export async function getSettings(tenantId: string): Promise<SettingsResponse> {
  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [number] = await tx.select({ e164: phoneNumbers.e164 }).from(phoneNumbers).where(eq(phoneNumbers.status, "active")).limit(1);
    if (!tenant) throw new HttpError(404, "not_found", "Business not found.");
    return {
      businessName: tenant.name,
      trade: tenant.trade,
      ownerName: tenant.ownerName,
      ownerCell: tenant.ownerCellE164,
      city: tenant.city,
      state: tenant.state,
      timezone: tenant.timezone,
      licenseNumber: tenant.licenseNumber,
      insuranceCarrier: tenant.insuranceCarrier,
      yearsInBusiness: tenant.yearsInBusiness,
      avgJobValueCents: tenant.avgJobValueCents,
      ringTimeoutSecs: tenant.ringTimeoutSecs,
      dispatcherEnabled: tenant.dispatcherEnabled,
      valueProofFrequency: tenant.valueProofFrequency,
      trackingNumber: number?.e164 ?? null,
    };
  });
}

export async function updateSettings(tenantId: string, userId: string, input: SettingsUpdateInput) {
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(tenants)
      .set({
        ...(input.businessName !== undefined && { name: input.businessName }),
        ...(input.ownerName !== undefined && { ownerName: input.ownerName }),
        ...(input.ownerCell !== undefined && { ownerCellE164: input.ownerCell }),
        ...(input.city !== undefined && { city: input.city || null }),
        ...(input.state !== undefined && { state: input.state ? input.state.toUpperCase() : null }),
        ...(input.timezone !== undefined && { timezone: input.timezone }),
        ...(input.licenseNumber !== undefined && { licenseNumber: input.licenseNumber || null }),
        ...(input.insuranceCarrier !== undefined && { insuranceCarrier: input.insuranceCarrier || null }),
        ...(input.yearsInBusiness !== undefined && { yearsInBusiness: input.yearsInBusiness }),
        ...(input.avgJobValueDollars !== undefined && { avgJobValueCents: input.avgJobValueDollars * 100 }),
        ...(input.ringTimeoutSecs !== undefined && { ringTimeoutSecs: input.ringTimeoutSecs }),
        ...(input.dispatcherEnabled !== undefined && { dispatcherEnabled: input.dispatcherEnabled }),
        ...(input.valueProofFrequency !== undefined && { valueProofFrequency: input.valueProofFrequency }),
      })
      .where(eq(tenants.id, tenantId));
    await audit(tx, { tenantId, actor: `user:${userId}`, action: "settings.updated", entityType: "tenant", entityId: tenantId, data: { fields: Object.keys(input) } });
  });
  return getSettings(tenantId);
}

export type { OnboardingInput };

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "business";
