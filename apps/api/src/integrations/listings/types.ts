import type { ListingProviderName, WeekdayKey } from "@leadanchor/contracts";

/**
 * Business listing port (module 9, C-21): read and write the business's Google listing. Google
 * Business Profile plugs in here in step 2 (OAuth per business); a simulator stands in until then.
 */

/** One day's opening hours on the listing; null is closed. */
export type ListingHours = Record<WeekdayKey, { start: string; end: string } | null>;

/** The fields LeadAnchor keeps up to date on the listing. */
export interface ListingDetails {
  phone: string | null;
  website: string | null;
  hours: ListingHours | null;
  /** The listing's "Book" / appointment link (C-10, C-18). */
  bookingLink: string | null;
  address: { street: string; city: string; state: string; postalCode: string } | null;
  /** The WhatsApp chat link (C-21 "set WA chat link"). */
  chatLink: string | null;
}

export interface ListingSnapshot {
  name: string;
  details: ListingDetails;
  rating: number | null;
  reviewCount: number;
  /** Where customers write a review: the link in review requests (C-46). */
  reviewUrl: string;
  /** The listing as customers see it. */
  listingUrl: string;
}

export interface ExternalReview {
  id: string;
  reviewer: string;
  rating: number;
  text: string | null;
  publishedAt: Date;
  /** The business's reply, however it was posted (here or on Google itself). */
  reply: { text: string; updatedAt: Date } | null;
}

export interface ListingProvider {
  readonly name: ListingProviderName;
  /** Where to send the owner to allow access (OAuth), or null when no sign-in is needed. */
  authorizeUrl(state: string, redirectUri: string): string | null;
  /** Finishes connecting: the location, its name, and the credentials to keep (encrypted). */
  finishConnect(input: {
    tenantId: string;
    businessName: string;
    code: string | null;
    redirectUri: string;
  }): Promise<{ account: string; locationName: string; credentials: string | null }>;
  snapshot(account: string): Promise<ListingSnapshot>;
  /** Writes these fields to the listing; fields left out stay as they are. */
  update(account: string, patch: Partial<ListingDetails>): Promise<void>;
  /** Every review on the listing, newest first. */
  reviews(account: string): Promise<ExternalReview[]>;
  /** Posts (or replaces) the business's reply to a review. */
  reply(account: string, reviewId: string, text: string): Promise<void>;
  /** Publishes an update to the listing ("content publication"). */
  publishPost(account: string, text: string): Promise<{ id: string }>;
}
