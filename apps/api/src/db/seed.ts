import { onboardingInput } from "@leadanchor/contracts";
import { eq } from "drizzle-orm";
import { auth } from "../auth/auth";
import { env } from "../config/env";
import { approveRegistrationForDev } from "../modules/compliance/registration.service";
import { findMembership, onboardTenant } from "../modules/tenants/tenant.service";
import { closeDatabase, systemDb } from "./client";
import { user } from "./schema";

/**
 * Local demo data: one owner account with a ready-to-use business (texting already
 * "approved"), so anyone can sign in and place simulator calls straight away.
 * Run with `pnpm db:seed`; running it again changes nothing.
 * Development only — this login is public in the repository, so it never runs in production.
 */
const DEMO_OWNER = { name: "Demo Owner", email: "demo@leadanchor.test", password: "leadanchor-demo-2026" };

const DEMO_BUSINESS = onboardingInput.parse({
  businessName: "Demo Plumbing & Heating",
  trade: "plumbing",
  ownerName: DEMO_OWNER.name,
  ownerCell: "(512) 555-0100",
  city: "Austin",
  state: "TX",
  timezone: "America/Chicago",
  avgJobValueDollars: 350,
});

async function main() {
  if (env.NODE_ENV === "production") throw new Error("The demo seed is for local development only.");

  const [existing] = await systemDb.select({ id: user.id }).from(user).where(eq(user.email, DEMO_OWNER.email));
  const userId = existing?.id ?? (await auth.api.signUpEmail({ body: DEMO_OWNER })).user.id;

  if (await findMembership(userId)) {
    console.log("✓ Demo business already exists — nothing to do.");
  } else {
    const tenantId = await onboardTenant(userId, DEMO_BUSINESS);
    await approveRegistrationForDev(tenantId, userId);
    console.log(`✓ Created "${DEMO_BUSINESS.businessName}".`);
  }
  console.log(`  Sign in at http://localhost:3000 as ${DEMO_OWNER.email} (the password is in apps/api/src/db/seed.ts).`);
}

main()
  .catch((error) => {
    console.error("✖ seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
    process.exit();
  });
