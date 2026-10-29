import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/*
 * Tables owned by Better Auth (identity only). Property names must match
 * Better Auth's field names; column names follow our snake_case convention.
 * Business membership lives in our own `memberships` table.
 */

const tz = { withTimezone: true } as const;

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", tz),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", tz),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
