import { REGISTRATION_STATUS_COPY, type RegistrationResponse, registrationInput } from "@leadanchor/contracts";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { carrierRegistrations } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { withTenant } from "../../db/client";
import { encryptSecret } from "../../lib/crypto";
import { iso } from "../../lib/time";
import { telephony } from "../../container";
import { audit } from "./audit";

type RegistrationData = z.output<typeof registrationInput>;

/**
 * Carrier registration (A2P 10DLC, C-43). Two auto-routed paths: businesses with
 * an EIN register a Standard brand; sole proprietors without one use their personal
 * details plus a mobile OTP. Tax IDs and dates of birth are encrypted at rest and
 * only ever shown masked. Outbound SMS stays hard-blocked until status = approved.
 */
export async function getRegistration(tenantId: string): Promise<RegistrationResponse> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(carrierRegistrations).where(eq(carrierRegistrations.tenantId, tenantId));
    const status = row?.status ?? "not_started";
    return {
      path: row?.path ?? null,
      status,
      statusCopy: REGISTRATION_STATUS_COPY[status],
      displayName: row?.displayName ?? null,
      maskedTaxId: row?.taxIdLast4 ? `••-•••${row.taxIdLast4}` : row?.path === "sole_proprietor" ? "No EIN — sole proprietor" : null,
      submittedAt: iso(row?.submittedAt),
      approvedAt: iso(row?.approvedAt),
      smsEnabled: status === "approved",
    };
  });
}

export async function submitRegistration(tenantId: string, userId: string, input: RegistrationData) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [existing] = await tx.select().from(carrierRegistrations).where(eq(carrierRegistrations.tenantId, tenantId));
    if (existing?.status === "approved") return;

    const now = new Date();
    const values =
      input.path === "standard"
        ? {
            path: input.path,
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
              address: { street: input.street, city: input.city, state: input.state.toUpperCase(), postalCode: input.postalCode },
            },
          }
        : {
            path: input.path,
            displayName: `${input.firstName} ${input.lastName}`,
            taxIdEncrypted: null,
            taxIdLast4: null,
            dateOfBirthEncrypted: encryptSecret(input.dateOfBirth),
            details: {
              mobile: input.mobile,
              email: input.email,
              otpVerified: false,
              address: { street: input.street, city: input.city, state: input.state.toUpperCase(), postalCode: input.postalCode },
            },
          };

    // With Telnyx connected this is where the brand + campaign are created through the 10DLC API;
    // the simulator moves straight to "in review" so the rest of the product can be exercised.
    const status = telephony.name === "simulator" ? ("in_review" as const) : ("submitted" as const);

    if (existing) {
      await tx.update(carrierRegistrations).set({ ...values, status, submittedAt: now, statusReason: null }).where(eq(carrierRegistrations.id, existing.id));
    } else {
      await tx.insert(carrierRegistrations).values({ tenantId, ...values, status, submittedAt: now });
    }

    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "registration.submitted",
      entityType: "carrier_registration",
      data: { path: input.path },
    });
    fx.publish({ type: "registration.updated" });
  });
  return getRegistration(tenantId);
}

/** Development only: pretend the carriers approved the business. */
export async function approveRegistrationForDev(tenantId: string, userId: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [existing] = await tx.select().from(carrierRegistrations).where(eq(carrierRegistrations.tenantId, tenantId));
    const now = new Date();
    if (existing) {
      await tx.update(carrierRegistrations).set({ status: "approved", approvedAt: now }).where(eq(carrierRegistrations.id, existing.id));
    } else {
      await tx.insert(carrierRegistrations).values({ tenantId, path: "standard", displayName: "Simulated registration", status: "approved", submittedAt: now, approvedAt: now });
    }
    await audit(tx, { tenantId, actor: `user:${userId}`, action: "registration.approved_simulated", entityType: "carrier_registration" });
    fx.publish({ type: "registration.updated" });
  });
  return getRegistration(tenantId);
}
