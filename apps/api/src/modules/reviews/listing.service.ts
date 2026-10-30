import {
  type ListingProviderName,
  type ListingResponse,
  type ListingStatus,
  type ListingSyncFields,
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  type WeekdayKey,
  listingSettingsInput,
  replyLint,
} from "@leadanchor/contracts";
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import type { z } from "zod";
import { ai, listingProviders } from "../../container";
import { type Tx, systemDb, withTenant } from "../../db/client";
import {
  leads,
  listingConnections,
  listingPosts,
  phoneNumbers,
  services,
  tenants,
} from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import type { ListingDetails, ListingHours } from "../../integrations/listings/types";
import { QUEUES, enqueue } from "../../jobs/queue";
import { encryptSecret } from "../../lib/crypto";
import { HttpError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { iso } from "../../lib/time";
import { bookingUrl, settingsOf } from "../booking/core";
import { audit } from "../compliance/audit";
import { whatsappLinkFor } from "../chat/links";
import { requestUrl } from "../intake/intake.service";
import { profileUrl } from "../profile/profile";
import { ingestReviews } from "./reviews.service";

type Tenant = typeof tenants.$inferSelect;
type Connection = typeof listingConnections.$inferSelect;

const DAY_MS = 86_400_000;
const WEEK: WeekdayKey[] = [...WEEKDAY_KEYS.slice(1), "sun"];

const DEFAULT_SYNC_FIELDS: ListingSyncFields = {
  hours: true,
  phone: true,
  website: true,
  bookingLink: true,
  address: true,
  chatLink: true,
};

/** Fields added later are on for connections made before them. */
const syncFieldsOf = (connection: Connection | null | undefined): ListingSyncFields => ({
  ...DEFAULT_SYNC_FIELDS,
  ...connection?.syncFields,
});

export function listingStatusOf(connection: Connection | null | undefined): ListingStatus {
  return {
    provider: connection?.provider ?? null,
    connected: Boolean(connection),
    locationName: connection?.locationName ?? null,
    rating: connection?.rating ?? null,
    reviewCount: connection?.reviewCount ?? 0,
    reviewUrl: connection?.reviewUrl ?? null,
    listingUrl: connection?.listingUrl ?? null,
    lastSyncedAt: iso(connection?.lastSyncedAt),
    lastPushedAt: iso(connection?.lastPushedAt),
    error: connection?.lastError ?? null,
    simulated: !listingProviders.google,
  };
}

export async function connectionOf(tenantId: string) {
  const [connection] = await withTenant(tenantId, (tx) =>
    tx.select().from(listingConnections).limit(1),
  );
  return connection ?? null;
}

/** The Google link a review request carries: the connected listing's, or the one the owner pasted. */
export const reviewLinkOf = (
  tenant: Pick<Tenant, "googleProfileUrl">,
  connection: Connection | null | undefined,
) => connection?.reviewUrl ?? tenant.googleProfileUrl ?? null;

const clock = (value: string) => {
  const [hour, minute] = value.split(":").map(Number) as [number, number];
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
};

export const hoursList = (hours: ListingHours | null) =>
  WEEK.map((day) => {
    const open = hours?.[day];
    return {
      day: WEEKDAY_LABELS[day],
      hours: open ? `${clock(open.start)} – ${clock(open.end)}` : "Closed",
    };
  });

/** What LeadAnchor writes to the listing, all from the business's own settings (C-21). */
async function desiredDetails(tx: Tx, tenant: Tenant) {
  const [number] = await tx
    .select({ e164: phoneNumbers.e164 })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.status, "active"))
    .limit(1);
  const settings = settingsOf(tenant);
  const hours = Object.fromEntries(
    WEEKDAY_KEYS.map((day) => [
      day,
      settings.hours[day].open
        ? { start: settings.hours[day].start, end: settings.hours[day].end }
        : null,
    ]),
  ) as ListingHours;
  const address =
    tenant.streetAddress && tenant.city && tenant.state && tenant.postalCode
      ? {
          street: tenant.streetAddress,
          city: tenant.city,
          state: tenant.state,
          postalCode: tenant.postalCode,
        }
      : null;
  const details: ListingDetails = {
    // The LeadAnchor line, so calls from Google are caught too (C-01).
    phone: number?.e164 ?? null,
    website: tenant.website ?? profileUrl(tenant.slug),
    hours,
    bookingLink: `${settings.enabled ? bookingUrl(tenant.slug) : requestUrl(tenant.slug)}?src=google`,
    address,
    // C-21: the WhatsApp chat link, so Google's Chat button opens a chat the assistant answers.
    chatLink: whatsappLinkFor(tenant.name, number?.e164),
  };
  return { details, bookingLinkIs: settings.enabled ? ("booking" as const) : ("request" as const) };
}

export async function getListing(tenantId: string): Promise<ListingResponse> {
  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [connection] = await tx.select().from(listingConnections).limit(1);
    const posts = await tx
      .select()
      .from(listingPosts)
      .orderBy(desc(listingPosts.createdAt))
      .limit(10);
    const { details, bookingLinkIs } = await desiredDetails(tx, tenant!);
    return {
      listing: listingStatusOf(connection),
      replyTone: tenant!.reviewReplyTone,
      syncFields: syncFieldsOf(connection),
      pushes: {
        hours: hoursList(details.hours),
        phone: details.phone,
        website: details.website!,
        bookingLink: details.bookingLink!,
        bookingLinkIs,
        address: details.address
          ? `${details.address.street}, ${details.address.city}, ${details.address.state} ${details.address.postalCode}`
          : null,
        chatLink: details.chatLink,
      },
      posts: posts.map((post) => ({
        id: post.id,
        text: post.text,
        status: post.status,
        error: post.error,
        createdAt: post.createdAt.toISOString(),
      })),
    };
  });
}

/**
 * Connects the business's Google listing (module 9). Google sends the owner to sign in first
 * (step 2); the simulator connects straight away. The listing is then brought up to date and read.
 */
export async function connectListing(
  tenantId: string,
  userId: string,
  provider: ListingProviderName,
  redirectUri: string,
): Promise<{ url: string | null }> {
  const adapter = listingProviders[provider];
  if (!adapter) throw new HttpError(409, "not_available", "That listing can't be connected yet.");
  const signIn = adapter.authorizeUrl(tenantId, redirectUri);
  if (signIn) return { url: signIn };

  const [tenant] = await withTenant(tenantId, (tx) =>
    tx.select().from(tenants).where(eq(tenants.id, tenantId)),
  );
  const { account, locationName, credentials } = await adapter.finishConnect({
    tenantId,
    businessName: tenant!.name,
    code: null,
    redirectUri,
  });
  await tenantWork(tenantId, async (tx, fx) => {
    const values = {
      provider,
      account,
      locationName,
      credentialsSealed: credentials ? encryptSecret(credentials) : null,
      lastError: null,
    };
    await tx
      .insert(listingConnections)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: listingConnections.tenantId, set: values });
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "listing.connected",
      entityType: "listing",
      entityId: tenantId,
      data: { provider },
    });
    fx.publish({ type: "reviews.updated" });
  });
  await pushListing(tenantId);
  await syncListing(tenantId);
  return { url: null };
}

export async function disconnectListing(tenantId: string, userId: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    await tx.delete(listingConnections);
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "listing.disconnected",
      entityType: "listing",
      entityId: tenantId,
    });
    fx.publish({ type: "reviews.updated" });
  });
  return getListing(tenantId);
}

/** Writes the business's details to the listing, the fields the owner left on (C-21). */
export async function pushListing(tenantId: string) {
  const connection = await connectionOf(tenantId);
  const adapter = connection ? listingProviders[connection.provider] : undefined;
  if (!connection || !adapter) return;
  const { details } = await withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    return desiredDetails(tx, tenant!);
  });
  const fields = syncFieldsOf(connection);
  const patch: Partial<ListingDetails> = {
    ...(fields.hours && { hours: details.hours }),
    ...(fields.phone && details.phone && { phone: details.phone }),
    ...(fields.website && { website: details.website }),
    ...(fields.bookingLink && { bookingLink: details.bookingLink }),
    ...(fields.address && details.address && { address: details.address }),
    ...(fields.chatLink && details.chatLink && { chatLink: details.chatLink }),
  };
  try {
    if (Object.keys(patch).length > 0) await adapter.update(connection.account, patch);
    await markConnection(tenantId, connection.id, { lastPushedAt: new Date(), lastError: null });
  } catch (error) {
    logger.warn({ err: error, tenantId }, "listing update failed");
    await markConnection(tenantId, connection.id, {
      lastError: `Couldn't update Google: ${(error as Error).message}`,
    });
  }
}

/** Reads the listing: rating, count, and new or changed reviews (C-21 reverse sync). */
export async function syncListing(tenantId: string) {
  const connection = await connectionOf(tenantId);
  const adapter = connection ? listingProviders[connection.provider] : undefined;
  if (!connection || !adapter) return;
  try {
    const [snapshot, external] = await Promise.all([
      adapter.snapshot(connection.account),
      adapter.reviews(connection.account),
    ]);
    await tenantWork(tenantId, async (tx, fx) => {
      await tx
        .update(listingConnections)
        .set({
          locationName: snapshot.name,
          rating: snapshot.rating,
          reviewCount: snapshot.reviewCount,
          reviewUrl: snapshot.reviewUrl,
          listingUrl: snapshot.listingUrl,
          lastSyncedAt: new Date(),
          lastError: null,
        })
        .where(eq(listingConnections.id, connection.id));
      await ingestReviews(tx, fx, { tenantId, external });
      fx.publish({ type: "reviews.updated" });
    });
  } catch (error) {
    logger.warn({ err: error, tenantId }, "listing sync failed");
    await markConnection(tenantId, connection.id, {
      lastError: `Couldn't read Google: ${(error as Error).message}`,
    });
  }
}

async function markConnection(tenantId: string, id: string, values: Partial<Connection>) {
  await tenantWork(tenantId, async (tx, fx) => {
    await tx.update(listingConnections).set(values).where(eq(listingConnections.id, id));
    fx.publish({ type: "reviews.updated" });
  });
}

export async function syncListingNow(tenantId: string) {
  await pushListing(tenantId);
  await syncListing(tenantId);
  return getListing(tenantId);
}

export async function updateListingSettings(
  tenantId: string,
  userId: string,
  input: z.output<typeof listingSettingsInput>,
) {
  let push = false;
  await tenantWork(tenantId, async (tx, fx) => {
    if (input.replyTone)
      await tx
        .update(tenants)
        .set({ reviewReplyTone: input.replyTone })
        .where(eq(tenants.id, tenantId));
    if (input.syncFields) {
      const [connection] = await tx.select().from(listingConnections).limit(1);
      if (!connection)
        throw new HttpError(409, "not_connected", "Connect your Google listing first.");
      const syncFields: ListingSyncFields = { ...syncFieldsOf(connection), ...input.syncFields };
      await tx
        .update(listingConnections)
        .set({ syncFields })
        .where(eq(listingConnections.id, connection.id));
      push = true;
    }
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "listing.settings_updated",
      entityType: "listing",
      entityId: tenantId,
      data: input,
    });
    fx.publish({ type: "reviews.updated" });
  });
  if (push) await pushListing(tenantId);
  return getListing(tenantId);
}

/** After the business's details change: keep the listing in step (C-21 "automatically"). */
export async function queueListingPush(tenantId: string) {
  if (await connectionOf(tenantId)) await enqueue(QUEUES.listingPush, { tenantId });
}

/* ── Jobs ───────────────────────────────────────────────────────────────── */

export async function listingSyncTickJob() {
  const rows = await systemDb
    .select({ tenantId: listingConnections.tenantId })
    .from(listingConnections);
  for (const row of rows) await syncListing(row.tenantId);
}

export const listingSyncJob = (data: { tenantId: string }) => syncListing(data.tenantId);
export const listingPushJob = (data: { tenantId: string }) => pushListing(data.tenantId);

/* ── Posts: updates published to the listing ("content publication") ───── */

/** An update to post, from the business's real recent work; the owner edits it before posting. */
export async function draftListingPost(tenantId: string): Promise<{ text: string }> {
  const facts = await withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const offered = await tx
      .select({ name: services.name })
      .from(services)
      .where(eq(services.active, true))
      .limit(8);
    const recent = await tx
      .select({ service: leads.serviceCategory })
      .from(leads)
      .where(
        and(
          eq(leads.stage, "won"),
          // The service actually done; a job's title can be anything ("Hung up before leaving a message").
          isNotNull(leads.serviceCategory),
          gt(leads.wonAt, new Date(Date.now() - 45 * DAY_MS)),
        ),
      )
      .orderBy(desc(leads.wonAt))
      .limit(12);
    const work = [...new Set(recent.map((row) => row.service!))].slice(0, 5);
    return { tenant: tenant!, services: offered.map((row) => row.name), work };
  });
  const { tenant } = facts;
  const area = [tenant.city, tenant.state].filter(Boolean).join(", ") || null;
  const callToAction = settingsOf(tenant).enabled ? "book" : "call";
  if (ai.configured) {
    try {
      const { text } = await ai.draftListingPost({
        businessName: tenant.name,
        trade: tenant.trade,
        area,
        services: facts.services,
        recentWork: facts.work,
        callToAction,
        timeoutMs: 15_000,
      });
      if (replyLint(text).length === 0) return { text };
    } catch (error) {
      logger.warn({ err: error, tenantId }, "listing post draft fell back to a template");
    }
  }
  const busy = facts.work.length
    ? `Busy weeks at ${tenant.name}: ${facts.work.slice(0, 3).join(", ").toLowerCase()} and more`
    : `${tenant.name} is taking new jobs`;
  const help = facts.services.length
    ? ` Need help with ${facts.services.slice(0, 2).join(" or ").toLowerCase()}?`
    : "";
  return {
    text: `${busy}${area ? ` around ${area}` : ""}.${help} ${callToAction === "book" ? "Pick a time with the Book button." : "Give us a call."}`,
  };
}

export async function publishListingPost(tenantId: string, userId: string, text: string) {
  const connection = await connectionOf(tenantId);
  const adapter = connection ? listingProviders[connection.provider] : undefined;
  if (!connection || !adapter)
    throw new HttpError(409, "not_connected", "Connect your Google listing first.");
  let result: { externalId: string | null; error: string | null };
  try {
    result = { externalId: (await adapter.publishPost(connection.account, text)).id, error: null };
  } catch (error) {
    result = { externalId: null, error: `Google didn't publish it: ${(error as Error).message}` };
  }
  await tenantWork(tenantId, async (tx, fx) => {
    await tx.insert(listingPosts).values({
      tenantId,
      text,
      status: result.error ? "failed" : "posted",
      externalId: result.externalId,
      error: result.error,
      createdBy: `user:${userId}`,
    });
    await audit(tx, {
      tenantId,
      actor: `user:${userId}`,
      action: "listing.post_published",
      entityType: "listing",
      entityId: tenantId,
      data: { ok: !result.error },
    });
    fx.publish({ type: "reviews.updated" });
  });
  if (result.error) throw new HttpError(502, "listing_failed", result.error);
  return getListing(tenantId);
}
