import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExternalReview, ListingDetails, ListingProvider, ListingSnapshot } from "./types";

interface SimReview {
  id: string;
  reviewer: string;
  rating: number;
  text: string | null;
  publishedAt: string;
  reply: { text: string; updatedAt: string } | null;
}

interface SimListing {
  name: string;
  details: ListingDetails;
  reviews: Record<string, SimReview>;
  posts: Array<{ id: string; text: string; createdAt: string }>;
  failNextReply: boolean;
}

type Store = Record<string, SimListing>;

const newId = (prefix: string) => `${prefix}_sim_${randomBytes(8).toString("hex")}`;

/**
 * A stand-in for Google Business Profile while it isn't set up: one listing per business, kept
 * in a file. Its public page (/sim/google/<account>) is where a customer leaves a review, so the
 * whole loop runs locally: review request, review, AI-drafted reply, owner approval, posted reply.
 */
export class SimulatorListings implements ListingProvider {
  readonly name = "simulator" as const;
  private cache: Store | null = null;

  constructor(
    private readonly file: string,
    /** The simulated listing page, e.g. http://localhost:3000/sim/google/<account>. */
    private readonly pageUrl: (account: string) => string,
  ) {}

  authorizeUrl() {
    return null;
  }

  async finishConnect(input: { tenantId: string; businessName: string }) {
    const account = `sim-${input.tenantId}`;
    this.write((store) => {
      const listing = (store[account] ??= {
        name: input.businessName,
        details: { phone: null, website: null, hours: null, bookingLink: null, address: null },
        reviews: {},
        posts: [],
        failNextReply: false,
      });
      listing.name = input.businessName;
    });
    return { account, locationName: input.businessName, credentials: null };
  }

  async snapshot(account: string): Promise<ListingSnapshot> {
    const listing = this.listing(this.read(), account);
    const ratings = Object.values(listing.reviews).map((review) => review.rating);
    return {
      name: listing.name,
      details: listing.details,
      rating: ratings.length
        ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
        : null,
      reviewCount: ratings.length,
      reviewUrl: `${this.pageUrl(account)}#write`,
      listingUrl: this.pageUrl(account),
    };
  }

  async update(account: string, patch: Partial<ListingDetails>) {
    this.write((store) => Object.assign(this.listing(store, account).details, patch));
  }

  async reviews(account: string): Promise<ExternalReview[]> {
    return Object.values(this.listing(this.read(), account).reviews)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .map((review) => ({
        id: review.id,
        reviewer: review.reviewer,
        rating: review.rating,
        text: review.text,
        publishedAt: new Date(review.publishedAt),
        reply: review.reply
          ? { text: review.reply.text, updatedAt: new Date(review.reply.updatedAt) }
          : null,
      }));
  }

  async reply(account: string, reviewId: string, text: string) {
    const listing = this.listing(this.read(), account);
    if (listing.failNextReply) {
      this.write((store) => (this.listing(store, account).failNextReply = false));
      throw new Error("Google didn't accept the reply just now (simulated outage).");
    }
    if (!listing.reviews[reviewId]) throw new Error("That review is no longer on Google.");
    this.write((store) => {
      this.listing(store, account).reviews[reviewId]!.reply = {
        text,
        updatedAt: new Date().toISOString(),
      };
    });
  }

  async publishPost(account: string, text: string) {
    const id = newId("post");
    this.write((store) => {
      this.listing(store, account).posts.unshift({ id, text, createdAt: new Date().toISOString() });
    });
    return { id };
  }

  /* ── The simulated listing page: what a customer sees, and where they write a review ── */

  view(account: string) {
    return this.read()[account] ?? null;
  }

  addReview(account: string, input: { reviewer: string; rating: number; text: string | null }) {
    const id = newId("review");
    this.write((store) => {
      this.listing(store, account).reviews[id] = {
        id,
        reviewer: input.reviewer,
        rating: input.rating,
        text: input.text,
        publishedAt: new Date().toISOString(),
        reply: null,
      };
    });
    return id;
  }

  setFailNextReply(account: string, fail: boolean) {
    this.write((store) => (this.listing(store, account).failNextReply = fail));
  }

  private listing(store: Store, account: string) {
    const listing = store[account];
    if (!listing) throw new Error("That listing isn't connected.");
    return listing;
  }

  private read(): Store {
    if (this.cache) return this.cache;
    this.cache = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, "utf8")) as Store)
      : {};
    return this.cache;
  }

  private write(change: (store: Store) => unknown) {
    const store = this.read();
    change(store);
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(store, null, 2));
    renameSync(temp, this.file);
  }
}
