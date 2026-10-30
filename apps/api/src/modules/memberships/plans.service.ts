import type { PlanItem, PlansResponse, planInput } from "@leadanchor/contracts";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { payments } from "../../container";
import { type Tx, withTenant } from "../../db/client";
import { membershipPlans, paymentAccounts, planMemberships, services } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { randomToken } from "../../lib/crypto";
import { HttpError, notFound } from "../../lib/errors";
import { audit } from "../compliance/audit";
import { cardsReady } from "../payments/payment.service";
import { signupUrl } from "./links";

type Plan = typeof membershipPlans.$inferSelect;

export async function paymentAccountOf(tx: Tx) {
  const [account] = await tx.select().from(paymentAccounts).limit(1);
  return account ?? null;
}

/**
 * The Stripe Price new members join at, made the first time it's needed (so a plan can be drafted
 * before card payments are set up). A price change gets a new Price; existing members keep theirs.
 */
export async function ensurePrice(tx: Tx, plan: Plan): Promise<string | null> {
  if (plan.providerPriceId && plan.provider === payments.name) return plan.providerPriceId;
  const account = await paymentAccountOf(tx);
  if (!cardsReady(account)) return null;
  const { productId, priceId } = await payments.createPrice({
    accountId: account.providerAccountId,
    productId: plan.provider === payments.name ? plan.providerProductId : null,
    name: plan.name,
    description: plan.description,
    amountCents: plan.priceCents,
    interval: plan.interval,
    idempotencyKey: `plan:${plan.id}:${plan.priceCents}:${plan.interval}`,
  });
  await tx
    .update(membershipPlans)
    .set({ provider: payments.name, providerProductId: productId, providerPriceId: priceId })
    .where(eq(membershipPlans.id, plan.id));
  return priceId;
}

async function checkService(tx: Tx, serviceId: string | null) {
  if (!serviceId) return;
  const [service] = await tx
    .select({ id: services.id })
    .from(services)
    .where(eq(services.id, serviceId));
  if (!service)
    throw new HttpError(422, "validation_failed", "Pick a service from your price list.", {
      workServiceId: ["Pick a service"],
    });
}

function checkCadence(input: z.output<typeof planInput>) {
  if (input.workCadence.kind === "months" && input.workCadence.months.length === 0)
    throw new HttpError(422, "validation_failed", "Pick the months the job goes on your board.", {
      workCadence: ["Pick at least one month"],
    });
}

export async function listPlans(tenantId: string): Promise<PlansResponse> {
  return withTenant(tenantId, async (tx) => {
    const plans = await tx
      .select()
      .from(membershipPlans)
      .orderBy(asc(membershipPlans.status), desc(membershipPlans.createdAt));
    const counts = await tx
      .select({
        planId: planMemberships.planId,
        active: sql<number>`count(*) filter (where ${planMemberships.status} = 'active')::int`,
        pastDue: sql<number>`count(*) filter (where ${planMemberships.status} = 'past_due')::int`,
        paused: sql<number>`count(*) filter (where ${planMemberships.status} = 'paused')::int`,
        olderPrice: sql<number>`count(*) filter (where ${planMemberships.status} in ('active', 'past_due', 'paused') and (${planMemberships.priceCents} <> ${membershipPlans.priceCents} or ${planMemberships.interval} <> ${membershipPlans.interval}))::int`,
      })
      .from(planMemberships)
      .innerJoin(membershipPlans, eq(membershipPlans.id, planMemberships.planId))
      .groupBy(planMemberships.planId);
    const byPlan = new Map(counts.map(({ planId, ...rest }) => [planId, rest]));
    const serviceIds = plans
      .map((plan) => plan.workServiceId)
      .filter((id): id is string => Boolean(id));
    const names = new Map(
      serviceIds.length
        ? (
            await tx
              .select({ id: services.id, name: services.name })
              .from(services)
              .where(inArray(services.id, serviceIds))
          ).map((row) => [row.id, row.name])
        : [],
    );
    return {
      plans: plans.map((plan) =>
        toPlanItem(plan, byPlan.get(plan.id), names.get(plan.workServiceId ?? "") ?? null),
      ),
      cardsReady: cardsReady(await paymentAccountOf(tx)),
    };
  });
}

function toPlanItem(
  plan: Plan,
  counts: PlanItem["members"] | undefined,
  workServiceName: string | null,
): PlanItem {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceCents: plan.priceCents,
    interval: plan.interval,
    includes: plan.includes,
    workServiceId: plan.workServiceId,
    workServiceName,
    workCadence: plan.workCadence,
    welcomeMessage: plan.welcomeMessage,
    status: plan.status,
    signupUrl: signupUrl(plan.linkToken),
    members: counts ?? { active: 0, pastDue: 0, paused: 0, olderPrice: 0 },
    createdAt: plan.createdAt.toISOString(),
  };
}

/** C-48: the owner builds a plan; it can be shared as soon as card payments are on. */
export async function createPlan(
  tenantId: string,
  input: z.output<typeof planInput>,
  actor: string,
) {
  checkCadence(input);
  const id = await tenantWork(tenantId, async (tx) => {
    await checkService(tx, input.workServiceId);
    const [plan] = await tx
      .insert(membershipPlans)
      .values({ tenantId, ...input, linkToken: randomToken() })
      .returning();
    await audit(tx, {
      tenantId,
      actor,
      action: "plan.created",
      entityType: "membership_plan",
      entityId: plan!.id,
      data: { name: plan!.name, priceCents: plan!.priceCents, interval: plan!.interval },
    });
    await ensurePrice(tx, plan!);
    return plan!.id;
  });
  return planById(tenantId, id);
}

/**
 * Edits a plan. A new price or billing interval applies to people who join from now on; existing
 * members keep the price they agreed to (C-48 AC 2: nobody is re-priced silently).
 */
export async function updatePlan(
  tenantId: string,
  id: string,
  input: z.output<typeof planInput>,
  actor: string,
) {
  checkCadence(input);
  await tenantWork(tenantId, async (tx) => {
    const [plan] = await tx
      .select()
      .from(membershipPlans)
      .where(eq(membershipPlans.id, id))
      .for("update");
    if (!plan) throw notFound("Plan");
    await checkService(tx, input.workServiceId);
    const repriced = plan.priceCents !== input.priceCents || plan.interval !== input.interval;
    const [updated] = await tx
      .update(membershipPlans)
      .set({ ...input, ...(repriced && { providerPriceId: null }) })
      .where(eq(membershipPlans.id, id))
      .returning();
    if (repriced) {
      await audit(tx, {
        tenantId,
        actor,
        action: "plan.repriced",
        entityType: "membership_plan",
        entityId: id,
        data: {
          from: { priceCents: plan.priceCents, interval: plan.interval },
          to: { priceCents: input.priceCents, interval: input.interval },
        },
      });
      await ensurePrice(tx, updated!);
    }
  });
  return planById(tenantId, id);
}

/** C-48 AC 4: archiving stops new sign-ups; existing members carry on. */
export async function setPlanArchived(
  tenantId: string,
  id: string,
  archived: boolean,
  actor: string,
) {
  await tenantWork(tenantId, async (tx) => {
    const [plan] = await tx
      .update(membershipPlans)
      .set({ status: archived ? "archived" : "active", archivedAt: archived ? new Date() : null })
      .where(eq(membershipPlans.id, id))
      .returning({ id: membershipPlans.id });
    if (!plan) throw notFound("Plan");
    await audit(tx, {
      tenantId,
      actor,
      action: archived ? "plan.archived" : "plan.restored",
      entityType: "membership_plan",
      entityId: id,
    });
  });
  return planById(tenantId, id);
}

async function planById(tenantId: string, id: string) {
  const plan = (await listPlans(tenantId)).plans.find((item) => item.id === id);
  if (!plan) throw notFound("Plan");
  return plan;
}

export async function activePlan(tx: Tx, id: string) {
  const [plan] = await tx
    .select()
    .from(membershipPlans)
    .where(and(eq(membershipPlans.id, id), eq(membershipPlans.status, "active")));
  return plan ?? null;
}
