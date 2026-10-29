import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, tsz } from "./columns";
import { customers, leads } from "./crm";
import { tenantRef } from "./tenancy";

/** A no-login link sent to a customer (C-07). Only the token's hash is stored. */
export const intakeRequests = pgTable(
  "intake_requests",
  {
    id: pk(),
    tenantId: tenantRef(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    status: text("status", { enum: ["sent", "opened", "submitted", "expired"] }).notNull().default("sent"),
    expiresAt: tsz("expires_at").notNull(),
    openedAt: tsz("opened_at"),
    submittedAt: tsz("submitted_at"),
    submission: jsonb("submission").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("intake_requests_token_uq").on(t.tokenHash), index("intake_requests_lead_idx").on(t.leadId)],
);

/** Photos from customers (C-09) and call recordings. Files live in object storage; this is the index. */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: pk(),
    tenantId: tenantRef(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["photo", "recording"] }).notNull(),
    storageKey: text("storage_key").notNull(),
    thumbKey: text("thumb_key"),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256").notNull(),
    aiStatus: text("ai_status", { enum: ["pending", "done", "failed", "skipped"] }).notNull().default("pending"),
    aiTags: jsonb("ai_tags").$type<Record<string, unknown>>(),
    aiError: text("ai_error"),
    /** The owner chose to show this photo in their public work gallery (C-41). */
    showcase: boolean("showcase").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("media_assets_lead_idx").on(t.leadId)],
);
