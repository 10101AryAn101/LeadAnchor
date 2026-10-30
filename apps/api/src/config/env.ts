import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

// Load apps/api/.env (git-ignored) into process.env. Real environments inject variables directly.
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const flag = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((value) => value === "true" || value === "1");

const optional = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().default(4000),
  PUBLIC_WEB_URL: z.url().default("http://localhost:3000"),
  PUBLIC_API_URL: z.url().default("http://localhost:4000"),

  // PostgreSQL. The app role is subject to row-level security; the system role
  // bypasses it for routing lookups (e.g. "which business owns this number?") and jobs.
  DATABASE_URL: z.string().default("postgres://leadanchor_app:leadanchor_app@localhost:5433/leadanchor"),
  DATABASE_SYSTEM_URL: z
    .string()
    .default("postgres://leadanchor_system:leadanchor_system@localhost:5433/leadanchor"),
  DATABASE_ADMIN_URL: z.string().default("postgres://postgres:postgres@localhost:5433/leadanchor"),

  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  // base64-encoded 32-byte key used to encrypt tax IDs and dates of birth at rest (C-43).
  DATA_ENCRYPTION_KEY: z.string().min(40, "DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key"),

  // AI — Google Gemini (no LLM vendor is mandated by the spec).
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  // Off by default. Set e.g. gemini-3.6-flash to use it when the main model is overloaded (503).
  GEMINI_FALLBACK_MODEL: optional,
  GEMINI_TIMEOUT_MS: z.coerce.number().int().default(60_000),

  // Telephony — Telnyx is mandated. "simulator" drives the same call engine locally.
  TELEPHONY_PROVIDER: z.enum(["simulator", "telnyx"]).default("simulator"),
  TELNYX_API_KEY: optional,
  TELNYX_PUBLIC_KEY: optional,
  TELNYX_CONNECTION_ID: optional,
  TELNYX_MESSAGING_PROFILE_ID: optional,
  TELNYX_WEBHOOK_TOLERANCE_SECS: z.coerce.number().int().default(300),

  // Messaging channels.
  SMS_PROVIDER: z.enum(["simulator", "telnyx"]).default("simulator"),
  WHATSAPP_ACCESS_TOKEN: optional,
  WHATSAPP_PHONE_NUMBER_ID: optional,
  WHATSAPP_APP_SECRET: optional,
  WHATSAPP_VERIFY_TOKEN: optional,
  // "dev" keeps emails in the local outbox; "resend" sends them through Resend.
  EMAIL_TRANSPORT: z.enum(["dev", "smtp", "resend"]).default("dev"),
  SMTP_URL: optional,
  EMAIL_FROM: z.string().default("LeadAnchor <no-reply@leadanchor.local>"),
  RESEND_API_KEY: optional,
  RESEND_WEBHOOK_SECRET: optional,
  // Test mode: every email goes to this address instead (Resend's own test addresses excepted).
  EMAIL_TEST_RECIPIENT: optional,

  // Consent ledger (C-27). The spec names a Firebase ledger; "local" is an
  // append-only, hash-chained Postgres ledger used until Firebase is set up.
  // "local-and-firestore" keeps checking the local ledger and copies every new record to Firestore.
  CONSENT_LEDGER: z.enum(["local", "firestore", "local-and-firestore"]).default("local"),
  FIREBASE_PROJECT_ID: z.string().default("demo-leadanchor"),
  FIRESTORE_EMULATOR_HOST: optional,
  GOOGLE_APPLICATION_CREDENTIALS: optional,
  FCM_ENABLED: flag,
  // The Firebase web app's settings, handed to browsers so they can receive alerts. Public by design.
  FIREBASE_WEB_API_KEY: optional,
  FIREBASE_WEB_APP_ID: optional,
  FIREBASE_MESSAGING_SENDER_ID: optional,
  FIREBASE_VAPID_KEY: optional,

  STORAGE_DIR: z.string().default("./storage"),

  // C-22: waitlist offers go by email until counsel confirms the waitlist opt-in wording
  // covers texts. Platform-wide, so it is a deployment setting rather than a business one.
  WAITLIST_TEXTS_CLEARED: flag,

  // Quote PDFs (C-45) are printed by headless Chrome or Edge. Found automatically on a
  // desktop; set the path on a server (e.g. /usr/bin/chromium).
  PDF_BROWSER_PATH: optional,

  // Card payments (Stripe Connect + Billing). Without a key the local Stripe simulator runs.
  // Test mode: an sk_test_ key; webhooks arrive through the tunnel (docs/integrations/test-mode-setup.md).
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,

  // Later phases — read now so the integrations page can report them honestly.
  GBP_CLIENT_ID: optional,
  // Google sign-in for Google Calendar (OAuth web client). Without it the simulated calendar stands in.
  GOOGLE_OAUTH_CLIENT_ID: optional,
  GOOGLE_OAUTH_CLIENT_SECRET: optional,
  /** C-46: minutes between marking a job Won and its review request going out (time to undo a mis-tap). */
  REVIEW_REQUEST_DELAY_MINUTES: z.coerce.number().int().min(0).max(1440).default(30),
  SCHEDULER_PROVIDER: optional,

  // Development helpers (call simulator, simulated carrier approval).
  DEV_TOOLS: flag,
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("\n✖ Invalid environment configuration for @leadanchor/api:\n");
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\nCopy apps/api/.env.example to apps/api/.env and fill in the values.\n");
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isDev = env.NODE_ENV === "development";
export const devToolsEnabled = env.NODE_ENV !== "production" && (env.DEV_TOOLS || isDev);

/**
 * In development `next dev` also serves the web app on this computer's local-network
 * address, so a teammate or a phone on the same Wi-Fi can open it (e.g. http://192.168.1.20:3000).
 * Sign-in has to trust that origin, and links we send out have to use it, or they would
 * point at the other device's own localhost.
 */
const lanWebOrigins = (() => {
  const { protocol, hostname, port } = new URL(env.PUBLIC_WEB_URL);
  if (!isDev || (hostname !== "localhost" && hostname !== "127.0.0.1")) return [];
  return Object.values(networkInterfaces())
    .flat()
    .flatMap((net) =>
      net && net.family === "IPv4" && !net.internal && !net.address.startsWith("169.254.")
        ? [`${protocol}//${net.address}${port ? `:${port}` : ""}`]
        : [],
    );
})();

/** Origins the web app is opened from. Sign-in rejects requests from any other page. */
export const webOrigins = [new URL(env.PUBLIC_WEB_URL).origin, ...lanWebOrigins];

/** Base for links people open on their own devices (intake forms, alert links). */
export const linkBaseUrl = lanWebOrigins[0] ?? env.PUBLIC_WEB_URL;
