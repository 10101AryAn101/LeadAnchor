import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { type AiVisibility, formatPhone } from "@leadanchor/contracts";
import { and, count, desc, eq, gte, inArray, isNotNull, max, sql } from "drizzle-orm";
import { linkBaseUrl } from "../../config/env";
import { ai, listingProviders } from "../../container";
import { systemDb } from "../../db/client";
import { type AskedQuestion, type Mismatch, aiVisibilityChecks, bookings, customers, leads, listingConnections, mediaAssets, phoneNumbers, reviews, services, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { HttpError, notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { featureOn } from "../billing/access";
import { bookingOpen, bookingUrl, settingsOf } from "../booking/core";
import { audit } from "../compliance/audit";
import { zipOf } from "../network/area";
import { profileUrl, siteUrl, websiteLive } from "../profile/links";
import { type AiProfileFacts, aiProfileOf } from "./ai-profile";
import { mentions, normalizeName, panelQuestions } from "./panel";

type Tenant = typeof tenants.$inferSelect;

const DAY_MS = 86_400_000;
const CHECK_EVERY_DAYS = 30;

/** The plan includes it (C-42 is Pro) and the owner hasn't switched it off (AC f). */
export const discoveryOn = (tenant: Tenant) => !tenant.aiDiscoveryOptOut && featureOn(tenant, "ai_discovery");

/* ── The AI-readable page ─────────────────────────────────────────────── */

/** The real records behind the page: the last year's work, asks, ZIPs, and the business's own settings. */
async function factsOf(tenant: Tenant, extras: { phone: string | null; rating: AiProfileFacts["rating"]; photoIds: string[] }): Promise<AiProfileFacts> {
  const since = new Date(Date.now() - 365 * DAY_MS);
  const [won, booked, asks, catalog, [latestReview]] = await Promise.all([
    systemDb
      .select({ category: leads.serviceCategory, address: customers.address, wonAt: leads.wonAt })
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .where(and(eq(leads.tenantId, tenant.id), eq(leads.stage, "won"), gte(leads.wonAt, since))),
    systemDb
      .select({ name: services.name, address: customers.address, at: bookings.startsAt })
      .from(bookings)
      .innerJoin(services, eq(services.id, bookings.serviceId))
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(and(eq(bookings.tenantId, tenant.id), eq(bookings.status, "completed"), gte(bookings.startsAt, since))),
    systemDb
      .select({ reason: leads.serviceCategory, count: count() })
      .from(leads)
      .where(and(eq(leads.tenantId, tenant.id), gte(leads.createdAt, since), isNotNull(leads.serviceCategory)))
      .groupBy(leads.serviceCategory)
      .orderBy(desc(count()))
      .limit(5),
    systemDb
      .select({ name: services.name })
      .from(services)
      .where(and(eq(services.tenantId, tenant.id), eq(services.active, true)))
      .orderBy(services.sortOrder),
    systemDb.select({ at: max(reviews.publishedAt) }).from(reviews).where(eq(reviews.tenantId, tenant.id)),
  ]);

  // Services it really did (won jobs and finished bookings); its own price list until it has any.
  const done = new Map<string, number>();
  for (const job of won) if (job.category) done.set(job.category, (done.get(job.category) ?? 0) + 1);
  for (const visit of booked) done.set(visit.name, (done.get(visit.name) ?? 0) + 1);
  const performed = [...done].sort((a, b) => b[1] - a[1]).map(([name, jobs]) => ({ name, jobs }));
  const zipCounts = new Map<string, number>();
  for (const { address } of [...won, ...booked]) {
    const zip = zipOf(address);
    if (zip) zipCounts.set(zip, (zipCounts.get(zip) ?? 0) + 1);
  }
  const lastWork = [...won.map((job) => job.wonAt), ...booked.map((visit) => visit.at), latestReview?.at ?? null]
    .filter((at): at is Date => at instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const settings = settingsOf(tenant);
  const page = profileUrl(tenant.slug);

  return {
    name: tenant.name,
    trade: tenant.trade,
    city: tenant.city,
    state: tenant.state,
    postalCode: tenant.postalCode,
    phone: extras.phone,
    pageUrl: page,
    bookingUrl: bookingOpen(tenant) ? bookingUrl(tenant.slug) : null,
    licenseNumber: tenant.licenseNumber,
    insuranceCarrier: tenant.insuranceCarrier,
    yearsInBusiness: tenant.yearsInBusiness,
    googleProfileUrl: tenant.googleProfileUrl,
    website: tenant.website,
    rating: extras.rating,
    services: performed.length > 0 ? performed.slice(0, 8) : catalog.slice(0, 8).map((service) => ({ name: service.name, jobs: 0 })),
    asks: asks.filter((ask) => ask.reason).map((ask) => ({ reason: ask.reason!, count: ask.count })),
    zips: [...zipCounts].sort((a, b) => b[1] - a[1]).map(([zip]) => zip),
    hours: tenant.booking ? settings.hours : null,
    photoUrls: extras.photoIds.map((id) => `${linkBaseUrl}/api/public/profile/${tenant.slug}/photos/${id}`),
    updatedAt: lastWork && lastWork > tenant.updatedAt ? lastWork : tenant.updatedAt,
  };
}

/** The AI-readable part of the public profile, or null when it's off for this business. */
export async function discoveryFor(tenant: Tenant, extras: { phone: string | null; rating: AiProfileFacts["rating"]; photoIds: string[] }) {
  if (!discoveryOn(tenant)) return null;
  return aiProfileOf(await factsOf(tenant, extras));
}

/** Public profiles worth listing in the sitemap: every live business that hasn't opted out. */
export async function sitemapProfiles() {
  const rows = await systemDb
    .select({ slug: tenants.slug, updatedAt: tenants.updatedAt, websiteStatus: tenants.websiteStatus })
    .from(tenants)
    .where(and(inArray(tenants.status, ["trial", "active", "past_due"]), eq(tenants.aiDiscoveryOptOut, false), isNotNull(tenants.onboardedAt)));
  // The profile for every business, and the website for those with the add-on (C-33).
  return rows.flatMap((row) => [
    { url: profileUrl(row.slug), updatedAt: row.updatedAt.toISOString() },
    ...(websiteLive(row) ? [{ url: siteUrl(row.slug), updatedAt: row.updatedAt.toISOString() }] : []),
  ]);
}

/* ── The monthly check: mentions, and whether the details agree ───────── */

/** The simulator's assistant: a stronger record (reviews, licence, photos) gets named a little more often. */
function simulatedAnswer(tenant: Tenant, question: string, strength: number): { answer: string; businesses: string[] } {
  let hash = 0;
  for (const char of `${tenant.id}:${question}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const named = hash % 100 < 15 + strength * 10;
  return {
    answer: named
      ? `(Simulated) ${tenant.name} is a well-reviewed option nearby.`
      : "(Simulated) Check recent reviews and ask for a licence number before you hire.",
    businesses: named ? [tenant.name] : [],
  };
}

const digits = (value: string) => value.replace(/\D/g, "");

/** Private, loopback and link-local addresses: never fetched for an owner's website (no reaching inside the network). */
function privateAddress(address: string) {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith("::ffff:")) return privateAddress(lower.slice(7));
    return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
  }
  const [a, b] = address.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** The owner's own website, as text: public addresses only, a few redirects, five seconds, 1 MB. */
async function readSite(url: string): Promise<string | null> {
  let next = url;
  for (let hop = 0; hop < 4; hop++) {
    const target = new URL(next);
    if (target.protocol !== "https:" && target.protocol !== "http:") return null;
    const addresses = await lookup(target.hostname, { all: true }).catch(() => []);
    if (addresses.length === 0 || addresses.some((entry) => privateAddress(entry.address))) return null;
    const response = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(5_000), headers: { "User-Agent": "LeadAnchor-consistency-check" } }).catch(() => null);
    if (!response) return null;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      next = new URL(location, target).toString();
      continue;
    }
    if (!response.ok) return null;
    const text = (await response.text()).slice(0, 1_000_000);
    return text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&");
  }
  return null;
}

/** C-42 point 5: where the name, phone, address or website disagree between LeadAnchor, Google and the owner's site. */
async function mismatchesOf(tenant: Tenant, line: string | null): Promise<Mismatch[]> {
  const found: Mismatch[] = [];
  const [connection] = await systemDb.select().from(listingConnections).where(eq(listingConnections.tenantId, tenant.id)).limit(1);
  const adapter = connection ? listingProviders[connection.provider] : undefined;
  if (connection && adapter) {
    const listing = await adapter.snapshot(connection.account).catch(() => null);
    if (listing) {
      if (normalizeName(listing.name) !== normalizeName(tenant.name)) {
        found.push({ field: "name", detail: `Google shows “${listing.name}”; LeadAnchor has “${tenant.name}”.` });
      }
      if (line && listing.details.phone && digits(listing.details.phone).slice(-10) !== digits(line).slice(-10)) {
        found.push({ field: "phone", detail: `Google shows ${formatPhone(listing.details.phone)}, not your LeadAnchor line ${formatPhone(line)}, so calls from Google aren't caught.` });
      }
      const googleZip = listing.details.address?.postalCode;
      if (googleZip && tenant.postalCode && googleZip !== tenant.postalCode) {
        found.push({ field: "address", detail: `Google has ZIP ${googleZip}; your LeadAnchor profile has ${tenant.postalCode}.` });
      }
    }
  }
  if (tenant.website) {
    const site = await readSite(tenant.website).catch(() => null);
    if (site === null) {
      found.push({ field: "website", detail: `We couldn't open ${tenant.website}. Check the address in Settings.` });
    } else {
      if (!normalizeName(site).includes(normalizeName(tenant.name))) {
        found.push({ field: "name", detail: `Your website doesn't show your business name as “${tenant.name}”.` });
      }
      if (line && !digits(site).includes(digits(line).slice(-10))) {
        found.push({ field: "phone", detail: `Your website doesn't show your LeadAnchor line ${formatPhone(line)}.` });
      }
    }
  }
  return found;
}

async function lineOf(tenantId: string) {
  const [number] = await systemDb
    .select({ e164: phoneNumbers.e164 })
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "active")))
    .limit(1);
  return number?.e164 ?? null;
}

/** Asks the panel, checks the details, and keeps the result (a time series of mention rates). */
export async function runVisibilityCheck(tenantId: string, options: { simulate?: boolean; force?: boolean } = {}): Promise<AiVisibility> {
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw notFound("Business");
  if (!discoveryOn(tenant)) throw new HttpError(409, "off", "Found by AI is off for your business.");
  const [last] = await systemDb
    .select({ at: aiVisibilityChecks.createdAt })
    .from(aiVisibilityChecks)
    .where(eq(aiVisibilityChecks.tenantId, tenantId))
    .orderBy(desc(aiVisibilityChecks.createdAt))
    .limit(1);
  if (!options.force && last && Date.now() - last.at.getTime() < DAY_MS) {
    throw new HttpError(429, "too_soon", "You checked in the last day. AI answers don't change that fast: try again tomorrow.");
  }

  const [line, topServices, [connection], [photos]] = await Promise.all([
    lineOf(tenantId),
    systemDb.select({ name: services.name }).from(services).where(and(eq(services.tenantId, tenantId), eq(services.active, true))).orderBy(services.sortOrder).limit(4),
    systemDb.select({ count: listingConnections.reviewCount }).from(listingConnections).where(eq(listingConnections.tenantId, tenantId)).limit(1),
    systemDb.select({ value: count() }).from(mediaAssets).where(and(eq(mediaAssets.tenantId, tenantId), eq(mediaAssets.showcase, true))),
  ]);
  const questions = panelQuestions({ trade: tenant.trade, city: tenant.city, state: tenant.state, zip: tenant.postalCode, services: topServices.map((service) => service.name) });
  const simulated = options.simulate === true || !ai.configured;
  const strength = Number((connection?.count ?? 0) >= 10) + Number(Boolean(tenant.licenseNumber)) + Number((photos?.value ?? 0) > 0);

  const asked: AskedQuestion[] = [];
  for (const question of questions) {
    const answer = simulated
      ? simulatedAnswer(tenant, question, strength)
      : await ai.answerLocalQuestion({ question, timeoutMs: 20_000 }).catch((error: unknown) => {
          logger.warn({ err: error, tenantId }, "AI visibility question failed");
          return null;
        });
    if (!answer) continue;
    asked.push({ question, mentioned: mentions(tenant.name, answer.businesses, answer.answer), named: answer.businesses.slice(0, 5) });
  }
  if (asked.length === 0) throw new HttpError(503, "ai_unavailable", "The AI assistant didn't answer just now. Try again later.");
  const mismatches = await mismatchesOf(tenant, line);

  await tenantWork(tenantId, async (tx, fx) => {
    await tx.insert(aiVisibilityChecks).values({
      tenantId,
      asked: asked.length,
      mentioned: asked.filter((item) => item.mentioned).length,
      questions: asked,
      mismatches,
      simulated,
    });
    fx.publish({ type: "discovery.updated" });
  });
  return getVisibility(tenantId);
}

/** What the dashboard card shows: the latest check, the trend, and what would help most. */
export async function getVisibility(tenantId: string): Promise<AiVisibility> {
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw notFound("Business");
  const [checks, [connection], [photos]] = await Promise.all([
    systemDb.select().from(aiVisibilityChecks).where(eq(aiVisibilityChecks.tenantId, tenantId)).orderBy(desc(aiVisibilityChecks.createdAt)).limit(12),
    systemDb.select().from(listingConnections).where(eq(listingConnections.tenantId, tenantId)).limit(1),
    systemDb.select({ value: count() }).from(mediaAssets).where(and(eq(mediaAssets.tenantId, tenantId), eq(mediaAssets.showcase, true))),
  ]);
  const latest = checks[0];
  const on = discoveryOn(tenant);
  const mismatches = latest?.mismatches ?? [];

  // C-42 point 7: two or three next steps, the ones that matter most first.
  const actions: AiVisibility["nextActions"] = [];
  if (mismatches.length > 0) {
    actions.push({ title: "Make your details match everywhere", detail: mismatches[0]!.detail, href: "/settings#profile" });
  }
  if (!connection) {
    actions.push({ title: "Connect your Google listing", detail: "Assistants lean on Google. Connect it so your hours, phone and reviews stay in step.", href: "/settings#google" });
  }
  if (!tenant.licenseNumber || !tenant.insuranceCarrier) {
    actions.push({ title: "Add your licence and insurance", detail: "Questions often ask for a licensed and insured pro.", href: "/settings#profile" });
  }
  if ((connection?.reviewCount ?? 0) < 10) {
    actions.push({ title: "Get more Google reviews", detail: "Mark finished jobs as won: each one gets a review request.", href: "/reviews" });
  }
  if ((photos?.value ?? 0) === 0) {
    actions.push({ title: "Show photos of your work", detail: "Open a job's photo and switch on “Show on my profile”.", href: "/leads" });
  }

  return {
    on,
    optedOut: tenant.aiDiscoveryOptOut,
    pageUrl: profileUrl(tenant.slug),
    latest: latest
      ? {
          checkedAt: latest.createdAt.toISOString(),
          asked: latest.asked,
          mentioned: latest.mentioned,
          questions: latest.questions,
          simulated: latest.simulated,
        }
      : null,
    history: [...checks].reverse().map((check) => ({ checkedAt: check.createdAt.toISOString(), rate: check.asked ? check.mentioned / check.asked : 0 })),
    mismatches,
    nextActions: actions.slice(0, 3),
    canCheckNow: on && (!latest || Date.now() - latest.createdAt.getTime() >= DAY_MS),
  };
}

/** AC f: one tap switches the AI-readable page and the monthly check off (or back on). */
export async function setDiscoveryOptOut(tenantId: string, userId: string, optedOut: boolean) {
  await tenantWork(tenantId, async (tx, fx) => {
    await tx.update(tenants).set({ aiDiscoveryOptOut: optedOut }).where(eq(tenants.id, tenantId));
    await audit(tx, { tenantId, actor: `user:${userId}`, action: optedOut ? "discovery.opted_out" : "discovery.opted_in", entityType: "tenant", entityId: tenantId });
    fx.publish({ type: "discovery.updated" });
  });
  return getVisibility(tenantId);
}

/**
 * Job, daily: the monthly check for businesses whose last one is a month old. A few a day, so the
 * AI's free daily quota is never used up by checks.
 */
export async function discoveryTickJob() {
  const due = await systemDb
    .select({ id: tenants.id, last: sql<Date | null>`(select max(${aiVisibilityChecks.createdAt}) from ${aiVisibilityChecks} where ${aiVisibilityChecks.tenantId} = ${tenants.id})` })
    .from(tenants)
    .where(and(inArray(tenants.status, ["trial", "active", "past_due"]), eq(tenants.aiDiscoveryOptOut, false), isNotNull(tenants.onboardedAt)));
  const cutoff = Date.now() - CHECK_EVERY_DAYS * DAY_MS;
  let ran = 0;
  for (const tenant of due) {
    if (ran >= 2) break;
    if (tenant.last && new Date(tenant.last).getTime() > cutoff) continue;
    const [row] = await systemDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    if (!row || !discoveryOn(row)) continue;
    try {
      await runVisibilityCheck(tenant.id, { force: true });
      ran += 1;
    } catch (error) {
      logger.warn({ err: error, tenantId: tenant.id }, "monthly AI visibility check failed");
    }
  }
}
