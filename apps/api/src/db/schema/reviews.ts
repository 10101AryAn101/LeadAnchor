import {
  LISTING_PROVIDERS,
  type ListingSyncFields,
  REVIEW_REPLY_STATUSES,
  REVIEW_REQUEST_OUTCOMES,
} from "@leadanchor/contracts";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk, tsz, updatedAt } from "./columns";
import { customers, leads } from "./crm";
import { messages } from "./messaging";
import { tenantRef } from "./tenancy";

/**
 * The business's Google listing (module 9, C-21): connected once per business. Rating and
 * count are copied in on every sync, so the profile page shows them without waiting on Google.
 */
export const listingConnections = pgTable(
  "listing_connections",
  {
    id: pk(),
    tenantId: tenantRef(),
    provider: text("provider", { enum: LISTING_PROVIDERS }).notNull(),
    /** The provider's location id. */
    account: text("account").notNull(),
    locationName: text("location_name"),
    /** The provider's refresh token (OAuth), encrypted. Null for the simulator. */
    credentialsSealed: text("credentials_sealed"),
    rating: doublePrecision("rating"),
    reviewCount: integer("review_count").notNull().default(0),
    reviewUrl: text("review_url"),
    listingUrl: text("listing_url"),
    /** Which fields LeadAnchor keeps up to date on the listing; the owner can turn each off. */
    syncFields: jsonb("sync_fields")
      .$type<ListingSyncFields>()
      .notNull()
      .default({ hours: true, phone: true, website: true, bookingLink: true, address: true, chatLink: true }),
    lastSyncedAt: tsz("last_synced_at"),
    lastPushedAt: tsz("last_pushed_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("listing_connections_tenant_uq").on(t.tenantId)],
);

/**
 * A Google review, read from the listing (C-21). Replies are drafted by the AI and posted only
 * once the owner approves (C-47); the owner also picks which ones show on their profile (C-23).
 */
export const reviews = pgTable(
  "reviews",
  {
    id: pk(),
    tenantId: tenantRef(),
    externalId: text("external_id").notNull(),
    reviewerName: text("reviewer_name").notNull(),
    rating: integer("rating").notNull(),
    text: text("text"),
    publishedAt: tsz("published_at").notNull(),
    replyText: text("reply_text"),
    replyPostedAt: tsz("reply_posted_at"),
    draftText: text("draft_text"),
    replyStatus: text("reply_status", { enum: REVIEW_REPLY_STATUSES })
      .notNull()
      .default("needs_reply"),
    replyError: text("reply_error"),
    /** Who approved the reply that's posting or posted. */
    replyApprovedBy: text("reply_approved_by"),
    showOnProfile: boolean("show_on_profile").notNull().default(false),
    /** The customer and job it's about, when the reviewer's name matches a recent completed job. */
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("reviews_external_uq").on(t.tenantId, t.externalId),
    index("reviews_tenant_time_idx").on(t.tenantId, t.publishedAt),
  ],
);

/**
 * C-46: the review request for one completed job. Every job marked Won gets a row, whether
 * or not it could be sent, so the record shows nobody was left out (AC 7).
 */
export const reviewRequests = pgTable(
  "review_requests",
  {
    id: pk(),
    tenantId: tenantRef(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    outcome: text("outcome", { enum: REVIEW_REQUEST_OUTCOMES }).notNull().default("scheduled"),
    detail: text("detail"),
    /** A short wait after Won, so a mis-tap can be undone before anything goes out. */
    sendAt: tsz("send_at").notNull(),
    sentAt: tsz("sent_at"),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    /** The customer's private line to the owner: looked up by hash; the sealed copy builds links. */
    tokenHash: text("token_hash").notNull(),
    tokenSealed: text("token_sealed").notNull(),
    feedbackAt: tsz("feedback_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("review_requests_lead_uq").on(t.leadId),
    uniqueIndex("review_requests_token_uq").on(t.tokenHash),
    index("review_requests_due_idx").on(t.outcome, t.sendAt),
  ],
);

/** Updates the owner published to the listing (module 9 "content publication"). */
export const listingPosts = pgTable(
  "listing_posts",
  {
    id: pk(),
    tenantId: tenantRef(),
    text: text("text").notNull(),
    status: text("status", { enum: ["posted", "failed"] }).notNull(),
    externalId: text("external_id"),
    error: text("error"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("listing_posts_tenant_idx").on(t.tenantId, t.createdAt)],
);

/**
 * Addresses that asked for no more marketing-type email from this business (CAN-SPAM).
 * Review requests and, later, campaigns check it; job emails (bookings, bills) don't.
 */
export const emailOptOuts = pgTable(
  "email_opt_outs",
  {
    id: pk(),
    tenantId: tenantRef(),
    /** Lower-cased. */
    email: text("email").notNull(),
    source: text("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("email_opt_outs_uq").on(t.tenantId, t.email)],
);
