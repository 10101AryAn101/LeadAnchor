import type { PublicProfile } from "@leadanchor/contracts";
import { and, asc, desc, eq } from "drizzle-orm";
import { linkBaseUrl } from "../../config/env";
import { systemDb } from "../../db/client";
import { mediaAssets, phoneNumbers, services, tenants } from "../../db/schema";
import { bookingUrl, settingsOf } from "../booking/core";
import { whatsappLinkFor } from "../chat/links";
import { profileReviews } from "../reviews/reviews.service";

type Tenant = typeof tenants.$inferSelect;

/** The business's public profile page (C-41). */
export const profileUrl = (slug: string) => `${linkBaseUrl}/p/${slug}`;

/**
 * The short line added to a new customer's first text. It only says "licensed & insured"
 * when the owner has entered both, and never "verified": these are the owner's own claims.
 */
export function profileLine(tenant: Pick<Tenant, "slug" | "licenseNumber" | "insuranceCarrier">) {
  const claim = tenant.licenseNumber && tenant.insuranceCarrier ? "Licensed & insured. " : "";
  return `${claim}Our profile: ${profileUrl(tenant.slug)}`;
}

/**
 * What anyone with the link may see: the owner's own business details, their services and
 * the photos they chose to show. Nothing about customers (C-41 AC 3).
 */
export async function getPublicProfile(slug: string): Promise<PublicProfile | null> {
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!tenant || tenant.status === "cancelled" || tenant.status === "suspended") return null;

  const [serviceRows, photoRows, [number], google] = await Promise.all([
    systemDb
      .select({ name: services.name, description: services.description })
      .from(services)
      .where(and(eq(services.tenantId, tenant.id), eq(services.active, true)))
      .orderBy(asc(services.sortOrder)),
    systemDb
      .select({ id: mediaAssets.id, aiTags: mediaAssets.aiTags })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.tenantId, tenant.id), eq(mediaAssets.showcase, true), eq(mediaAssets.kind, "photo")))
      .orderBy(desc(mediaAssets.createdAt))
      .limit(24),
    systemDb
      .select({ e164: phoneNumbers.e164 })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.tenantId, tenant.id), eq(phoneNumbers.status, "active")))
      .limit(1),
    profileReviews(tenant),
  ]);

  return {
    name: tenant.name,
    trade: tenant.trade,
    city: tenant.city,
    state: tenant.state,
    phone: number?.e164 ?? null,
    licenseNumber: tenant.licenseNumber,
    insuranceCarrier: tenant.insuranceCarrier,
    yearsInBusiness: tenant.yearsInBusiness,
    googleProfileUrl: tenant.googleProfileUrl,
    website: tenant.website,
    services: serviceRows,
    bookingUrl: settingsOf(tenant).enabled ? bookingUrl(tenant.slug) : null,
    whatsappLink: whatsappLinkFor(tenant.name, number?.e164),
    photos: photoRows.map((photo) => {
      const tags = (photo.aiTags ?? {}) as { itemType?: string; issue?: string };
      return { id: photo.id, caption: tags.itemType ?? tags.issue ?? null };
    }),
    // C-41 AC 2 and C-23: the live Google rating, and the reviews the owner chose to show.
    rating: google.rating,
    reviews: google.reviews,
  };
}

/** A gallery photo, only if this business chose to show it. */
export async function findShowcasePhoto(slug: string, mediaId: string) {
  const [row] = await systemDb
    .select({ storageKey: mediaAssets.storageKey, thumbKey: mediaAssets.thumbKey, mimeType: mediaAssets.mimeType })
    .from(mediaAssets)
    .innerJoin(tenants, eq(tenants.id, mediaAssets.tenantId))
    .where(and(eq(tenants.slug, slug), eq(mediaAssets.id, mediaId), eq(mediaAssets.showcase, true)))
    .limit(1);
  return row ?? null;
}
