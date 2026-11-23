import {
  type Feature,
  FEATURE_LABELS,
  FEATURE_TIER,
  type TenantSummary,
  TIER_DETAILS,
  accessTier,
  tierAllows,
} from "@leadanchor/contracts";
import { eq } from "drizzle-orm";
import { systemDb } from "../../db/client";
import { tenants } from "../../db/schema";
import { HttpError } from "../../lib/errors";

type AccountRow = Pick<typeof tenants.$inferSelect, "status" | "tier" | "trialEndsAt" | "isDemo">;

/** The business's LeadAnchor account as the app shows it (see accessTier for the rules). */
export const accountOf = (tenant: AccountRow, now = new Date()): TenantSummary["account"] => ({
  status: tenant.status,
  tier: accessTier(tenant, now),
  paidTier: tenant.tier,
  trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
});

/** For background work: whether this business's tier covers the feature right now. */
export const featureOn = (tenant: AccountRow, feature: Feature, now = new Date()) =>
  tierAllows(accessTier(tenant, now), feature);

/** The chat assistant answers: the owner has it switched on and the tier includes it (C-16 is Pro). */
export const assistantOn = (tenant: AccountRow & { assistantEnabled: boolean }) =>
  tenant.assistantEnabled && featureOn(tenant, "assistant");

/** Refuses an action the business's tier doesn't cover, saying which tier does. */
export function assertFeature(tenant: AccountRow, feature: Feature) {
  if (featureOn(tenant, feature)) return;
  const tier = TIER_DETAILS[FEATURE_TIER[feature]].name;
  throw new HttpError(
    402,
    "upgrade_required",
    tenant.status === "trial"
      ? `Your free trial has ended. ${FEATURE_LABELS[feature]} is part of ${tier}: choose a plan in Settings to keep using it.`
      : `${FEATURE_LABELS[feature]} is part of ${tier}. Upgrade in Settings to use it.`,
  );
}

const accountRow = async (tenantId: string) => {
  const [tenant] = await systemDb
    .select({ status: tenants.status, tier: tenants.tier, trialEndsAt: tenants.trialEndsAt, isDemo: tenants.isDemo })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return tenant ?? null;
};

/** assertFeature for a route that only has the business's id. */
export async function requireFeature(tenantId: string, feature: Feature) {
  const tenant = await accountRow(tenantId);
  if (!tenant) throw new HttpError(404, "not_found", "Business not found.");
  assertFeature(tenant, feature);
}

/** featureOn for a background job that only has the business's id. */
export async function featureOnFor(tenantId: string, feature: Feature) {
  const tenant = await accountRow(tenantId);
  return tenant ? featureOn(tenant, feature) : false;
}
