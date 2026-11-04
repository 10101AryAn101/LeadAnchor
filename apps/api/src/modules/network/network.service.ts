import {
  HANDOFF_FANOUT,
  HANDOFF_OFFER_HOURS,
  HANDOFF_SHARED_FIELDS,
  HANDOFF_STAY_DAYS,
  type HandoffInput,
  type HandoffItem,
  type LeadStage,
  NETWORK_TERMS_VERSION,
  type NetworkJoinInput,
  type NetworkOffer,
  type NetworkResponse,
  type NetworkUpdateInput,
  type PublicHandoff,
  REFERRALS_PER_FREE_MONTH,
  TRADE_LABELS,
  type Trade,
  formatPhone,
} from "@leadanchor/contracts";
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { linkBaseUrl } from "../../config/env";
import { type Tx, systemDb, withTenant } from "../../db/client";
import {
  customers,
  handoffOffers,
  leadHandoffs,
  leads,
  networkMembers,
  phoneNumbers,
  referralConversions,
  referralCredits,
  tenants,
} from "../../db/schema";
import { type Effects, tenantWork } from "../../db/unit-of-work";
import { randomToken, sha256 } from "../../lib/crypto";
import { HttpError, notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { realtime } from "../../lib/realtime";
import { featureOn } from "../billing/access";
import { audit } from "../compliance/audit";
import { upsertCustomerByPhone } from "../customers/customer.repo";
import { addLeadEvent, topPosition } from "../leads/lead-capture";
import { requestEmail, requestMessage } from "../messaging/send-path";
import { notifyOwner } from "../notifications/notify";
import { areaOf, zipOf } from "./area";
import { recordReferral } from "./referrals";

type Tenant = typeof tenants.$inferSelect;
type Customer = typeof customers.$inferSelect;
type Lead = typeof leads.$inferSelect;
type Handoff = typeof leadHandoffs.$inferSelect;

/** Jobs a business can pass on: not yet booked, won or lost. */
const PASSABLE_STAGES: LeadStage[] = ["new", "contacted", "quoted"];
/** The customer can still stay while the pro hasn't got further than a first call. */
const STAYABLE_STAGES: LeadStage[] = ["new", "contacted"];

export const handoffStayUrl = (token: string) => `${linkBaseUrl}/h/${token}`;
export const referralUrl = (code: string) => `${linkBaseUrl}/sign-up?ref=${code}`;

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null;
const iso = (value: Date | null) => value?.toISOString() ?? null;

/** What a business still needs before it can take passed jobs: proof of cover (C-41) and where it works. */
function missingToJoin(tenant: Tenant) {
  const missing: string[] = [];
  if (!tenant.licenseNumber && !tenant.insuranceCarrier) {
    missing.push("Your licence number or insurance carrier, so other pros know you're covered");
  }
  if (!tenant.state || (!tenant.city && !tenant.postalCode)) {
    missing.push("Your city, state and ZIP code, so jobs near you can find you");
  }
  return missing;
}

async function tenantOf(tenantId: string) {
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw notFound("Business");
  return tenant;
}

/** The business's LeadAnchor line, which reaches the owner: for the customer and the other pro. */
async function lineOf(tenantId: string) {
  const [number] = await systemDb
    .select({ e164: phoneNumbers.e164 })
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "active")))
    .limit(1);
  return number?.e164 ?? null;
}

/* ── The business's own network page ───────────────────────────────────── */

async function handoffsOf(tenantId: string, leadId: string | null, limit: number): Promise<HandoffItem[]> {
  const rows = await systemDb
    .select({
      handoff: leadHandoffs,
      title: leads.title,
      partnerName: tenants.name,
      partnerPhone: sql<string | null>`(select ${phoneNumbers.e164} from ${phoneNumbers} where ${phoneNumbers.tenantId} = ${leadHandoffs.partnerTenantId} and ${phoneNumbers.status} = 'active' limit 1)`,
    })
    .from(leadHandoffs)
    .innerJoin(leads, eq(leads.id, leadHandoffs.leadId))
    .leftJoin(tenants, eq(tenants.id, leadHandoffs.partnerTenantId))
    .where(and(eq(leadHandoffs.tenantId, tenantId), leadId ? eq(leadHandoffs.leadId, leadId) : undefined))
    .orderBy(desc(leadHandoffs.createdAt))
    .limit(limit);
  return rows.map(({ handoff, title, partnerName, partnerPhone }) => ({
    id: handoff.id,
    leadId: handoff.leadId,
    title,
    trade: handoff.trade,
    status: handoff.status,
    offeredTo: handoff.offeredTo,
    partner: handoff.partnerTenantId && partnerName ? { name: partnerName, phone: partnerPhone } : null,
    createdAt: handoff.createdAt.toISOString(),
    expiresAt: handoff.expiresAt.toISOString(),
    acceptedAt: iso(handoff.acceptedAt),
    declinedAt: iso(handoff.declinedAt),
    convertedAt: iso(handoff.convertedAt),
  }));
}

/** The latest time this job was passed to the network, for the job's page. */
export async function latestHandoff(tenantId: string, leadId: string) {
  return (await handoffsOf(tenantId, leadId, 1))[0] ?? null;
}

/** For a job that came from the network: the business that passed it. */
export async function passedBy(leadId: string) {
  const [row] = await systemDb
    .select({ name: tenants.name })
    .from(leadHandoffs)
    .innerJoin(tenants, eq(tenants.id, leadHandoffs.tenantId))
    .where(eq(leadHandoffs.partnerLeadId, leadId))
    .limit(1);
  return row?.name ?? null;
}

export async function getNetwork(tenantId: string): Promise<NetworkResponse> {
  const tenant = await tenantOf(tenantId);
  const total = (rows: Array<{ value: number }>) => rows[0]?.value ?? 0;
  const [member, passed, taken, received, won, joined, conversions, credits, handoffs] = await Promise.all([
    systemDb.select().from(networkMembers).where(eq(networkMembers.tenantId, tenantId)),
    systemDb.select({ value: count() }).from(leadHandoffs).where(eq(leadHandoffs.tenantId, tenantId)),
    systemDb
      .select({ value: count() })
      .from(leadHandoffs)
      .where(and(eq(leadHandoffs.tenantId, tenantId), isNotNull(leadHandoffs.acceptedAt))),
    systemDb
      .select({ value: count() })
      .from(handoffOffers)
      .where(and(eq(handoffOffers.tenantId, tenantId), eq(handoffOffers.status, "accepted"))),
    systemDb
      .select({ value: count() })
      .from(leadHandoffs)
      .where(and(eq(leadHandoffs.tenantId, tenantId), isNotNull(leadHandoffs.convertedAt))),
    systemDb.select({ value: count() }).from(tenants).where(eq(tenants.referredByTenantId, tenantId)),
    systemDb.select({ counted: referralConversions.counted }).from(referralConversions).where(eq(referralConversions.tenantId, tenantId)),
    systemDb.select({ appliedAt: referralCredits.appliedAt }).from(referralCredits).where(eq(referralCredits.tenantId, tenantId)),
    handoffsOf(tenantId, null, 20),
  ]);
  const row = member[0];
  return {
    member: row
      ? {
          available: row.available,
          trades: row.trades,
          termsVersion: row.termsVersion,
          termsAcceptedAt: row.termsAcceptedAt.toISOString(),
          termsOutdated: row.termsVersion !== NETWORK_TERMS_VERSION,
        }
      : null,
    missing: missingToJoin(tenant),
    stats: { passed: total(passed), taken: total(taken), received: total(received), won: total(won) },
    referral: {
      url: referralUrl(tenant.referralCode),
      joined: total(joined),
      counted: conversions.filter((conversion) => conversion.counted).length,
      perFreeMonth: REFERRALS_PER_FREE_MONTH,
      monthsEarned: credits.length,
      monthsWaiting: credits.filter((credit) => !credit.appliedAt).length,
      earning: featureOn(tenant, "referral_credits"),
    },
    handoffs,
  };
}

/** Joining means accepting the partner terms (guardrail 3): recorded with their version, who and when. */
export async function joinNetwork(tenantId: string, userId: string, input: Required<NetworkJoinInput>) {
  if (input.termsVersion !== NETWORK_TERMS_VERSION) {
    throw new HttpError(409, "terms_changed", "The partner terms have just changed. Read them again, then join.");
  }
  const missing = missingToJoin(await tenantOf(tenantId));
  if (missing.length > 0) {
    throw new HttpError(409, "not_ready", `Add this in Settings first: ${missing.join("; ")}.`);
  }
  const values = {
    available: input.available,
    trades: input.trades,
    termsVersion: NETWORK_TERMS_VERSION,
    termsAcceptedAt: new Date(),
    termsAcceptedBy: `user:${userId}`,
  };
  await tenantWork(tenantId, async (tx, fx) => {
    await tx
      .insert(networkMembers)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: networkMembers.tenantId, set: values });
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "network.joined",
      entityType: "tenant",
      entityId: tenantId,
      data: { termsVersion: NETWORK_TERMS_VERSION, trades: input.trades },
    });
    fx.publish({ type: "network.updated" });
  });
  return getNetwork(tenantId);
}

export async function updateNetwork(tenantId: string, input: NetworkUpdateInput) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [row] = await tx
      .update(networkMembers)
      .set({
        ...(input.available !== undefined && { available: input.available }),
        ...(input.trades !== undefined && { trades: input.trades }),
      })
      .where(eq(networkMembers.tenantId, tenantId))
      .returning({ tenantId: networkMembers.tenantId });
    if (!row) throw new HttpError(409, "not_member", "Join the network first.");
    fx.publish({ type: "network.updated" });
  });
  return getNetwork(tenantId);
}

/** Leaving stops new offers at once; offers still open to the business close. */
export async function leaveNetwork(tenantId: string, userId: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    await tx.delete(networkMembers).where(eq(networkMembers.tenantId, tenantId));
    await tx
      .update(handoffOffers)
      .set({ status: "closed", respondedAt: new Date() })
      .where(and(eq(handoffOffers.tenantId, tenantId), eq(handoffOffers.status, "pending")));
    await audit(tx, { tenantId, actor: `user:${userId}`, action: "network.left", entityType: "tenant", entityId: tenantId });
    fx.publish({ type: "network.updated" });
  });
  return getNetwork(tenantId);
}

/* ── Passing a job (the business that's too busy) ─────────────────────── */

/**
 * Up to HANDOFF_FANOUT pros who take this kind of work near the job: members on the current terms,
 * taking jobs, in the same state, nearest ZIP area and same city first.
 */
async function findPartners(sender: Tenant, trade: Trade, zip: string | null) {
  return systemDb
    .select({ id: tenants.id, name: tenants.name })
    .from(networkMembers)
    .innerJoin(tenants, eq(tenants.id, networkMembers.tenantId))
    .where(
      and(
        ne(tenants.id, sender.id),
        eq(networkMembers.available, true),
        eq(networkMembers.termsVersion, NETWORK_TERMS_VERSION),
        sql`${trade} = any(${networkMembers.trades})`,
        inArray(tenants.status, ["trial", "active", "past_due"]),
        eq(tenants.state, sender.state!),
      ),
    )
    .orderBy(
      // coalesce: a missing ZIP or city ranks last, not first (nulls sort first in descending order).
      sql`(coalesce(left(${tenants.postalCode}, 3), '') = ${zip?.slice(0, 3) ?? "-"}) desc`,
      sql`(coalesce(lower(${tenants.city}), '') = ${sender.city?.toLowerCase() ?? "-"}) desc`,
      sql`random()`,
    )
    .limit(HANDOFF_FANOUT);
}

export async function passLead(tenantId: string, userId: string, leadId: string, input: Required<HandoffInput>): Promise<HandoffItem> {
  const sender = await tenantOf(tenantId);
  const job = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ lead: leads, customer: customers })
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .where(eq(leads.id, leadId));
    return row ?? null;
  });
  if (!job) throw notFound("Job");
  if (!PASSABLE_STAGES.includes(job.lead.stage)) {
    throw new HttpError(409, "not_passable", "Only jobs that aren't booked yet can be passed on.");
  }
  if (!job.customer.phoneE164) {
    throw new HttpError(409, "no_phone", "Add the customer's phone number first: the pro who takes the job needs to call them.");
  }
  if (!sender.state) {
    throw new HttpError(409, "no_area", "Add your city and state in Settings, so we can find pros near this customer.");
  }
  const zip = zipOf(job.customer.address) ?? sender.postalCode;
  const partners = await findPartners(sender, input.trade, zip);
  if (partners.length === 0) {
    throw new HttpError(
      409,
      "no_partners",
      `No ${TRADE_LABELS[input.trade].toLowerCase()} pros near you are taking extra jobs right now. The job stays on your board.`,
    );
  }

  const expiresAt = new Date(Date.now() + HANDOFF_OFFER_HOURS * 3_600_000);
  const area = areaOf(sender, zip);
  const handoffId = await tenantWork(tenantId, async (tx, fx) => {
    // Locked, so two taps can't pass the same job twice.
    const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).for("update");
    const [open] = await tx
      .select({ id: leadHandoffs.id })
      .from(leadHandoffs)
      .where(and(eq(leadHandoffs.leadId, leadId), eq(leadHandoffs.status, "offered")))
      .limit(1);
    if (open) throw new HttpError(409, "already_offered", "This job is already with the network.");
    const [row] = await tx
      .insert(leadHandoffs)
      .values({
        tenantId,
        leadId,
        trade: input.trade,
        note: input.note || null,
        returnStage: lead!.stage,
        offeredTo: partners.length,
        createdBy: `user:${userId}`,
        expiresAt,
      })
      .returning({ id: leadHandoffs.id });
    await addLeadEvent(tx, {
      tenantId,
      leadId,
      type: "network.offered",
      actor: `user:${userId}`,
      data: { trade: input.trade, offeredTo: partners.length, expiresAt: expiresAt.toISOString() },
    });
    // Guardrail 5: who it went to and what they could see (the work and the area, nothing about the customer).
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "network.job_offered",
      entityType: "lead",
      entityId: leadId,
      data: { handoffId: row!.id, trade: input.trade, offeredTo: partners.map((partner) => partner.id), shared: ["job title", "area", "urgency"] },
    });
    fx.publish({ type: "lead.updated", leadId });
    fx.publish({ type: "network.updated" });
    return row!.id;
  });

  for (const partner of partners) {
    await tenantWork(partner.id, async (tx, fx) => {
      await tx.insert(handoffOffers).values({
        tenantId: partner.id,
        handoffId,
        fromBusiness: sender.name,
        trade: input.trade,
        title: job.lead.title,
        area,
        urgency: job.lead.urgency,
        note: input.note || null,
        expiresAt,
      });
      await notifyOwner(tx, fx, {
        tenantId: partner.id,
        kind: "network",
        title: `${TRADE_LABELS[input.trade]} job near ${area || "you"}`,
        body: `${sender.name} is passing on “${job.lead.title}”. The first pro to accept gets it.`,
        path: "/network",
      });
      fx.publish({ type: "network.updated" });
    });
  }
  return (await latestHandoff(tenantId, leadId))!;
}

/** The owner changed their mind before anyone took the job. */
export async function withdrawHandoff(tenantId: string, userId: string, handoffId: string) {
  const handoff = await tenantWork(tenantId, async (tx, fx) => {
    const [row] = await tx
      .update(leadHandoffs)
      .set({ status: "withdrawn", closedAt: new Date() })
      .where(and(eq(leadHandoffs.id, handoffId), eq(leadHandoffs.status, "offered")))
      .returning();
    if (!row) throw new HttpError(409, "not_open", "A pro has already taken this job, or the offer has ended.");
    await addLeadEvent(tx, { tenantId, leadId: row.leadId, type: "network.withdrawn", actor: `user:${userId}` });
    fx.publish({ type: "lead.updated", leadId: row.leadId });
    fx.publish({ type: "network.updated" });
    return row;
  });
  await closeOffers(handoff.id);
  return (await latestHandoff(tenantId, handoff.leadId))!;
}

/** The other pros' copies of a job that's gone: closed, and their screens told. */
async function closeOffers(handoffId: string) {
  const closed = await systemDb
    .update(handoffOffers)
    .set({ status: "closed", respondedAt: new Date() })
    .where(and(eq(handoffOffers.handoffId, handoffId), eq(handoffOffers.status, "pending")))
    .returning({ tenantId: handoffOffers.tenantId });
  for (const offer of closed) realtime.publish(offer.tenantId, { type: "network.updated" });
}

/* ── Taking a job (the pro it's offered to) ───────────────────────────── */

export async function listOffers(tenantId: string): Promise<{ offers: NetworkOffer[] }> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(handoffOffers).orderBy(desc(handoffOffers.createdAt)).limit(30),
  );
  const now = Date.now();
  return {
    offers: rows.map((offer) => ({
      id: offer.id,
      // The five-minute clean-up may not have closed it yet.
      status: offer.status === "pending" && offer.expiresAt.getTime() <= now ? "closed" : offer.status,
      fromBusiness: offer.fromBusiness,
      trade: offer.trade,
      title: offer.title,
      area: offer.area,
      urgency: offer.urgency,
      note: offer.note,
      offeredAt: offer.createdAt.toISOString(),
      expiresAt: offer.expiresAt.toISOString(),
      leadId: offer.leadId,
    })),
  };
}

/**
 * First to accept wins. The pro then gets the customer's name, number, job description and address
 * (guardrail 2) as a new job on their board; the business that passed it sees who took it; the
 * customer is told by name, with a link to stay (guardrails 1 and 4); both sides are audited (5).
 */
export async function acceptOffer(tenantId: string, userId: string, offerId: string): Promise<{ leadId: string }> {
  const [offer] = await withTenant(tenantId, (tx) => tx.select().from(handoffOffers).where(eq(handoffOffers.id, offerId)));
  if (!offer) throw notFound("Offer");
  if (offer.status === "accepted" && offer.leadId) return { leadId: offer.leadId };
  if (offer.status !== "pending") throw new HttpError(409, "offer_closed", "This job isn't available any more.");
  const [member] = await systemDb.select().from(networkMembers).where(eq(networkMembers.tenantId, tenantId));
  if (!member || member.termsVersion !== NETWORK_TERMS_VERSION) {
    throw new HttpError(409, "terms", "Accept the partner terms on the Network page first.");
  }

  const [claimed] = await systemDb
    .update(leadHandoffs)
    .set({ status: "accepted", partnerTenantId: tenantId, acceptedAt: new Date(), sharedFields: [...HANDOFF_SHARED_FIELDS] })
    .where(and(eq(leadHandoffs.id, offer.handoffId), eq(leadHandoffs.status, "offered"), gt(leadHandoffs.expiresAt, new Date())))
    .returning();
  if (!claimed) {
    await systemDb.update(handoffOffers).set({ status: "closed", respondedAt: new Date() }).where(eq(handoffOffers.id, offerId));
    realtime.publish(tenantId, { type: "network.updated" });
    throw new HttpError(409, "offer_taken", "Another pro took this job first, or the offer ended.");
  }

  const [source] = await systemDb
    .select({ lead: leads, customer: customers, sender: tenants })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .innerJoin(tenants, eq(tenants.id, leads.tenantId))
    .where(eq(leads.id, claimed.leadId));
  // The business kept the job after all (booked it, or closed it) while the offer was out.
  if (!source?.customer.phoneE164 || !PASSABLE_STAGES.includes(source.lead.stage)) {
    await systemDb.update(leadHandoffs).set({ status: "withdrawn", partnerTenantId: null, acceptedAt: null, sharedFields: [], closedAt: new Date() }).where(eq(leadHandoffs.id, claimed.id));
    await closeOffers(claimed.id);
    await systemDb.update(handoffOffers).set({ status: "closed", respondedAt: new Date() }).where(eq(handoffOffers.id, offerId));
    realtime.publish(tenantId, { type: "network.updated" });
    throw new HttpError(409, "offer_closed", `${offer.fromBusiness} has kept this job after all.`);
  }

  let partnerLeadId: string;
  try {
    partnerLeadId = await tenantWork(tenantId, async (tx, fx) => {
      const [partner] = await tx.select({ avgJobValueCents: tenants.avgJobValueCents }).from(tenants).where(eq(tenants.id, tenantId));
      const customer = await upsertCustomerByPhone(tx, tenantId, source.customer.phoneE164!, {
        name: source.customer.name,
        address: source.customer.address,
      });
      const [lead] = await tx
        .insert(leads)
        .values({
          tenantId,
          customerId: customer.id,
          source: "network",
          title: source.lead.title,
          summary: source.lead.summary,
          serviceCategory: source.lead.serviceCategory,
          urgency: source.lead.urgency,
          needsCallback: true,
          estimatedValueCents: partner?.avgJobValueCents ?? null,
          position: await topPosition(tx, tenantId, "new"),
        })
        .returning({ id: leads.id });
      await addLeadEvent(tx, {
        tenantId,
        leadId: lead!.id,
        type: "network.received",
        actor: `user:${userId}`,
        data: { from: source.sender.name, fields: [...HANDOFF_SHARED_FIELDS], note: claimed.note },
      });
      await tx.update(handoffOffers).set({ status: "accepted", respondedAt: new Date(), leadId: lead!.id }).where(eq(handoffOffers.id, offerId));
      await audit(tx, {
        tenantId,
        actor: `user:${userId}`,
        action: "network.job_received",
        entityType: "lead",
        entityId: lead!.id,
        data: { handoffId: claimed.id, from: source.sender.id, fromName: source.sender.name, fields: [...HANDOFF_SHARED_FIELDS] },
      });
      fx.publish({ type: "lead.created", leadId: lead!.id });
      fx.publish({ type: "network.updated" });
      return lead!.id;
    });
  } catch (error) {
    // This side couldn't be written: the job goes back on offer for the other pros.
    await systemDb
      .update(leadHandoffs)
      .set({ status: "offered", partnerTenantId: null, acceptedAt: null, sharedFields: [] })
      .where(eq(leadHandoffs.id, claimed.id));
    throw error;
  }

  const token = randomToken();
  await systemDb.update(leadHandoffs).set({ partnerLeadId, customerTokenHash: sha256(token) }).where(eq(leadHandoffs.id, claimed.id));
  await closeOffers(claimed.id);

  const [partner] = await systemDb.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
  const partnerName = partner?.name ?? offer.fromBusiness;
  const partnerPhone = await lineOf(tenantId);
  await tenantWork(claimed.tenantId, async (tx, fx) => {
    const sender = source.sender;
    await tx
      .update(leads)
      .set({ stage: "lost", lostReason: `Passed to ${partnerName}`, stageChangedAt: new Date(), needsCallback: false })
      .where(eq(leads.id, claimed.leadId));
    await addLeadEvent(tx, {
      tenantId: sender.id,
      leadId: claimed.leadId,
      type: "network.passed",
      data: { partner: partnerName, partnerPhone, fields: [...HANDOFF_SHARED_FIELDS] },
    });
    await audit(tx, {
      tenantId: sender.id,
      actor: "system",
      action: "network.job_passed",
      entityType: "lead",
      entityId: claimed.leadId,
      data: { handoffId: claimed.id, to: tenantId, toName: partnerName, fields: [...HANDOFF_SHARED_FIELDS] },
    });
    await notifyOwner(tx, fx, {
      tenantId: sender.id,
      kind: "network",
      title: `${partnerName} took “${source.lead.title}”`,
      body: `${firstName(source.customer.name) ?? "The customer"} gets a text saying so, and can choose to stay with you.`,
      leadId: claimed.leadId,
    });
    await tellCustomer(tx, fx, sender, source.customer, claimed.leadId, { name: partnerName, phone: partnerPhone }, token);
    fx.publish({ type: "lead.updated", leadId: claimed.leadId });
    fx.publish({ type: "network.updated" });
  });
  return { leadId: partnerLeadId };
}

/** Guardrail 1: no silent transfer. The customer hears who has their request, and can stay instead. */
async function tellCustomer(
  tx: Tx,
  fx: Effects,
  tenant: Tenant,
  customer: Customer,
  leadId: string,
  partner: { name: string; phone: string | null },
  token: string,
) {
  const first = firstName(customer.name);
  const line =
    `${first ? `Hi ${first}` : "Hi"}, it's ${tenant.name}. We're fully booked, so we've asked ${partner.name}, ` +
    `a local pro we trust, to take care of your request. They'll be in touch soon` +
    `${partner.phone ? ` from ${formatPhone(partner.phone)}` : ""}. Prefer to stay with us? Tap here: ${handoffStayUrl(token)}`;
  if (customer.phoneE164) {
    await requestMessage(tx, fx, {
      tenant,
      customerId: customer.id,
      leadId,
      to: customer.phoneE164,
      purpose: "transactional",
      body: `${line}\nReply STOP to opt out.`,
    });
  }
  if (customer.email) {
    await requestEmail(tx, fx, {
      tenant,
      customerId: customer.id,
      leadId,
      to: customer.email,
      purpose: "transactional",
      subject: `${partner.name} will take care of your request`,
      body: `${line}\n\n${tenant.name}`,
    });
  }
}

/** Not this one. When every pro has said no, the job comes back to the business straight away. */
export async function passOffer(tenantId: string, offerId: string) {
  const [offer] = await withTenant(tenantId, (tx) =>
    tx
      .update(handoffOffers)
      .set({ status: "passed", respondedAt: new Date() })
      .where(and(eq(handoffOffers.id, offerId), eq(handoffOffers.status, "pending")))
      .returning(),
  );
  if (!offer) throw new HttpError(409, "offer_closed", "This job isn't open any more.");
  realtime.publish(tenantId, { type: "network.updated" });
  const [stillOpen] = await systemDb
    .select({ value: count() })
    .from(handoffOffers)
    .where(and(eq(handoffOffers.handoffId, offer.handoffId), eq(handoffOffers.status, "pending")));
  if ((stillOpen?.value ?? 0) === 0) await expireHandoff(offer.handoffId);
  return listOffers(tenantId);
}

/** Nobody took it in time (or everyone said no): the job is still the business's, and it hears so. */
async function expireHandoff(handoffId: string) {
  const [handoff] = await systemDb
    .update(leadHandoffs)
    .set({ status: "expired", closedAt: new Date() })
    .where(and(eq(leadHandoffs.id, handoffId), eq(leadHandoffs.status, "offered")))
    .returning();
  if (!handoff) return;
  await closeOffers(handoff.id);
  await tenantWork(handoff.tenantId, async (tx, fx) => {
    const [lead] = await tx.select({ title: leads.title }).from(leads).where(eq(leads.id, handoff.leadId));
    await addLeadEvent(tx, { tenantId: handoff.tenantId, leadId: handoff.leadId, type: "network.expired" });
    await notifyOwner(tx, fx, {
      tenantId: handoff.tenantId,
      kind: "network",
      title: `No pro could take “${lead?.title ?? "the job"}”`,
      body: "It's still on your board. Call the customer back, or try passing it again later.",
      leadId: handoff.leadId,
    });
    fx.publish({ type: "lead.updated", leadId: handoff.leadId });
    fx.publish({ type: "network.updated" });
  });
}

/**
 * Job, every five minutes: offers nobody took in time come back to their business, and passed jobs
 * the partner has since won count as referrals (C-25).
 */
export async function networkTickJob() {
  const due = await systemDb
    .select({ id: leadHandoffs.id })
    .from(leadHandoffs)
    .where(and(eq(leadHandoffs.status, "offered"), lte(leadHandoffs.expiresAt, new Date())));
  for (const { id } of due) {
    try {
      await expireHandoff(id);
    } catch (error) {
      logger.error({ err: error, handoffId: id }, "handoff expiry failed");
    }
  }

  const won = await systemDb
    .select({ id: leadHandoffs.id, tenantId: leadHandoffs.tenantId })
    .from(leadHandoffs)
    .innerJoin(leads, eq(leads.id, leadHandoffs.partnerLeadId))
    .where(and(eq(leadHandoffs.status, "accepted"), isNull(leadHandoffs.convertedAt), eq(leads.stage, "won")));
  for (const handoff of won) {
    try {
      await systemDb.update(leadHandoffs).set({ convertedAt: new Date() }).where(eq(leadHandoffs.id, handoff.id));
      await recordReferral(handoff.tenantId, "handoff", handoff.id);
    } catch (error) {
      logger.error({ err: error, handoffId: handoff.id }, "handoff conversion failed");
    }
  }
  return { expired: due.length, converted: won.length };
}

/* ── The customer's choice (from the handoff text) ────────────────────── */

async function handoffByToken(token: string) {
  const [row] = await systemDb
    .select({ handoff: leadHandoffs, title: leads.title, businessName: tenants.name, partnerStage: sql<LeadStage | null>`(select ${leads.stage} from ${leads} where ${leads.id} = ${leadHandoffs.partnerLeadId})` })
    .from(leadHandoffs)
    .innerJoin(leads, eq(leads.id, leadHandoffs.leadId))
    .innerJoin(tenants, eq(tenants.id, leadHandoffs.tenantId))
    .where(eq(leadHandoffs.customerTokenHash, sha256(token)));
  if (!row) throw notFound("Request");
  return row;
}

const canStay = (handoff: Handoff, partnerStage: LeadStage | null) =>
  handoff.status === "accepted" &&
  handoff.acceptedAt !== null &&
  Date.now() - handoff.acceptedAt.getTime() < HANDOFF_STAY_DAYS * 86_400_000 &&
  (partnerStage === null || STAYABLE_STAGES.includes(partnerStage));

export async function publicHandoffView(token: string): Promise<PublicHandoff> {
  const { handoff, title, businessName, partnerStage } = await handoffByToken(token);
  const [partner] = handoff.partnerTenantId
    ? await systemDb.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, handoff.partnerTenantId))
    : [];
  return {
    businessName,
    partnerName: partner?.name ?? "the other pro",
    partnerPhone: handoff.partnerTenantId ? await lineOf(handoff.partnerTenantId) : null,
    job: title,
    status: handoff.status === "declined" ? "stayed" : handoff.status === "accepted" ? "with_partner" : "closed",
    canStay: canStay(handoff, partnerStage),
  };
}

/**
 * Guardrail 4: the customer would rather stay. The job goes back on the first business's board, and
 * the pro who took it loses it from theirs: with the customer's details, which they agreed to delete.
 */
export async function stayWithBusiness(token: string): Promise<PublicHandoff> {
  const { handoff, partnerStage } = await handoffByToken(token);
  if (handoff.status === "declined") return publicHandoffView(token);
  if (!canStay(handoff, partnerStage)) {
    throw new HttpError(409, "too_late", "This can't be changed here any more. Call the business instead.");
  }
  const [stayed] = await systemDb
    .update(leadHandoffs)
    .set({ status: "declined", declinedAt: new Date() })
    .where(and(eq(leadHandoffs.id, handoff.id), eq(leadHandoffs.status, "accepted")))
    .returning();
  if (!stayed) return publicHandoffView(token);

  const [[partner], [business]] = await Promise.all([
    systemDb.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, handoff.partnerTenantId!)),
    systemDb.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, handoff.tenantId)),
  ]);
  const customerName = await tenantWork(handoff.tenantId, async (tx, fx) => {
    const [row] = await tx
      .select({ title: leads.title, name: customers.name })
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .where(eq(leads.id, handoff.leadId));
    await tx
      .update(leads)
      .set({ stage: handoff.returnStage, lostReason: null, stageChangedAt: new Date(), needsCallback: true, lastActivityAt: new Date() })
      .where(eq(leads.id, handoff.leadId));
    await addLeadEvent(tx, { tenantId: handoff.tenantId, leadId: handoff.leadId, type: "network.stayed", data: { partner: partner?.name ?? null } });
    await audit(tx, {
      tenantId: handoff.tenantId,
      actor: "customer",
      action: "network.customer_stayed",
      entityType: "lead",
      entityId: handoff.leadId,
      data: { handoffId: handoff.id, partner: handoff.partnerTenantId },
    });
    await notifyOwner(tx, fx, {
      tenantId: handoff.tenantId,
      kind: "network",
      title: `${firstName(row?.name) ?? "Your customer"} wants to stay with you`,
      body: `“${row?.title ?? "The job"}” is back on your board. ${partner?.name ?? "The other pro"} has been told.`,
      leadId: handoff.leadId,
    });
    fx.publish({ type: "lead.updated", leadId: handoff.leadId });
    fx.publish({ type: "network.updated" });
    return row?.name ?? null;
  });

  if (handoff.partnerTenantId) {
    await tenantWork(handoff.partnerTenantId, async (tx, fx) => {
      if (handoff.partnerLeadId) {
        const [lead] = await tx.select({ customerId: leads.customerId }).from(leads).where(eq(leads.id, handoff.partnerLeadId));
        await tx.delete(leads).where(eq(leads.id, handoff.partnerLeadId));
        // The customer row goes too when this job brought it here and nothing else uses it.
        if (lead) {
          const [others] = await tx.select({ value: count() }).from(leads).where(eq(leads.customerId, lead.customerId));
          if ((others?.value ?? 0) === 0) {
            await tx
              .delete(customers)
              .where(and(eq(customers.id, lead.customerId), sql`${customers.firstSeenAt} >= ${handoff.acceptedAt!}`));
          }
        }
      }
      await audit(tx, {
        tenantId: handoff.partnerTenantId!,
        actor: "customer",
        action: "network.job_removed",
        entityType: "handoff",
        entityId: handoff.id,
        data: { reason: "customer_stayed", from: handoff.tenantId },
      });
      await notifyOwner(tx, fx, {
        tenantId: handoff.partnerTenantId!,
        kind: "network",
        title: `${firstName(customerName) ?? "The customer"} chose to stay with ${business?.name ?? "the other business"}`,
        body: "The job was taken off your board. Please don't contact them about it.",
        path: "/network",
      });
      if (handoff.partnerLeadId) fx.publish({ type: "lead.updated", leadId: handoff.partnerLeadId });
      fx.publish({ type: "network.updated" });
    });
  }
  return publicHandoffView(token);
}
