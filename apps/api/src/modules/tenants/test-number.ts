import { toE164 } from "@leadanchor/contracts";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { env } from "../../config/env";
import { systemDb } from "../../db/client";
import { phoneNumbers, tenants } from "../../db/schema";
import { logger } from "../../lib/logger";

/**
 * Telnyx trial (test mode). The trial gives one real number, ordered by hand in Telnyx; while
 * TELNYX_TEST_NUMBER and TELNYX_TEST_BUSINESS are set (with TELEPHONY_PROVIDER=telnyx), that
 * business answers on it and its simulated number is set aside. Remove the settings and the
 * simulated number comes back. Only numbers attached this way (no Telnyx order id) are touched,
 * so numbers LeadAnchor ordered itself are never affected. Runs once at startup.
 */
export async function syncTelnyxTestNumber() {
  const testNumber = env.TELNYX_TEST_NUMBER ? toE164(env.TELNYX_TEST_NUMBER) : null;
  if (env.TELNYX_TEST_NUMBER && !testNumber)
    logger.warn({ value: env.TELNYX_TEST_NUMBER }, "TELNYX_TEST_NUMBER isn't a valid phone number");
  const [business] =
    env.TELEPHONY_PROVIDER === "telnyx" && testNumber && env.TELNYX_TEST_BUSINESS
      ? await systemDb
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.slug, env.TELNYX_TEST_BUSINESS))
          .limit(1)
      : [];
  if (env.TELNYX_TEST_BUSINESS && testNumber && !business && env.TELEPHONY_PROVIDER === "telnyx")
    logger.warn(
      { slug: env.TELNYX_TEST_BUSINESS },
      "TELNYX_TEST_BUSINESS doesn't match a business",
    );

  await systemDb.transaction(async (tx) => {
    // Set aside any trial number that no longer matches the settings, and bring back what it replaced.
    const attached = await tx
      .select()
      .from(phoneNumbers)
      .where(
        and(
          eq(phoneNumbers.provider, "telnyx"),
          isNull(phoneNumbers.providerNumberId),
          eq(phoneNumbers.purpose, "tracking"),
          eq(phoneNumbers.status, "active"),
        ),
      );
    for (const row of attached) {
      if (business && row.tenantId === business.id && row.e164 === testNumber) continue;
      await tx.update(phoneNumbers).set({ status: "released" }).where(eq(phoneNumbers.id, row.id));
      const [previous] = await tx
        .select({ id: phoneNumbers.id })
        .from(phoneNumbers)
        .where(
          and(
            eq(phoneNumbers.tenantId, row.tenantId),
            eq(phoneNumbers.provider, "simulator"),
            eq(phoneNumbers.purpose, "tracking"),
            eq(phoneNumbers.status, "released"),
          ),
        )
        .orderBy(desc(phoneNumbers.createdAt))
        .limit(1);
      if (previous)
        await tx
          .update(phoneNumbers)
          .set({ status: "active" })
          .where(eq(phoneNumbers.id, previous.id));
      logger.info({ tenantId: row.tenantId, e164: row.e164 }, "Telnyx trial number set aside");
    }

    if (!business || !testNumber) return;
    const [current] = await tx
      .select({ id: phoneNumbers.id })
      .from(phoneNumbers)
      .where(
        and(
          eq(phoneNumbers.tenantId, business.id),
          eq(phoneNumbers.e164, testNumber),
          eq(phoneNumbers.status, "active"),
        ),
      )
      .limit(1);
    if (current) return;
    // The simulated number steps aside (kept, to come back later); the trial number takes over.
    await tx
      .update(phoneNumbers)
      .set({ status: "released" })
      .where(
        and(
          eq(phoneNumbers.tenantId, business.id),
          eq(phoneNumbers.purpose, "tracking"),
          eq(phoneNumbers.status, "active"),
          ne(phoneNumbers.e164, testNumber),
        ),
      );
    await tx
      .insert(phoneNumbers)
      .values({
        tenantId: business.id,
        e164: testNumber,
        provider: "telnyx",
        providerNumberId: null,
        purpose: "tracking",
        status: "active",
      })
      .onConflictDoUpdate({
        target: phoneNumbers.e164,
        set: {
          tenantId: business.id,
          provider: "telnyx",
          providerNumberId: null,
          purpose: "tracking",
          status: "active",
        },
      });
    logger.info(
      { slug: env.TELNYX_TEST_BUSINESS, e164: testNumber },
      "Telnyx trial number attached: the business answers on it",
    );
  });
}
