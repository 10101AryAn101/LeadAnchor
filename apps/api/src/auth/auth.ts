import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env, webOrigins } from "../config/env";
import { systemDb } from "../db/client";
import { account, session, user, verification } from "../db/schema";

/**
 * Owner and staff sign-in (Better Auth, self-hosted; identity data stays in our database).
 * Email + password locally; phone OTP (via Telnyx) and passkeys are the next methods to add.
 * End customers never sign in — they use signed, expiring links.
 */
export const auth = betterAuth({
  appName: "LeadAnchor",
  baseURL: env.PUBLIC_WEB_URL,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: webOrigins,
  database: drizzleAdapter(systemDb, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  advanced: {
    cookiePrefix: "leadanchor",
  },
});

export type AuthSession = typeof auth.$Infer.Session;
