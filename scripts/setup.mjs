// One-time local setup: creates the git-ignored env files with fresh secrets.
// Safe to re-run — existing files are never overwritten.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function createApiEnv() {
  const target = resolve(root, "apps/api/.env");
  if (existsSync(target)) return console.log("• apps/api/.env already exists — left as is");
  const template = readFileSync(resolve(root, "apps/api/.env.example"), "utf8");
  const filled = template
    .replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}`)
    .replace(/^DATA_ENCRYPTION_KEY=.*$/m, `DATA_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
  writeFileSync(target, filled);
  console.log("✓ created apps/api/.env with new secrets — add GEMINI_API_KEY to enable AI summaries");
}

function createWebEnv() {
  const target = resolve(root, "apps/web/.env.local");
  if (existsSync(target)) return console.log("• apps/web/.env.local already exists — left as is");
  copyFileSync(resolve(root, "apps/web/.env.example"), target);
  console.log("✓ created apps/web/.env.local");
}

createApiEnv();
createWebEnv();
console.log("\nNext: pnpm db:start (keep it running), then pnpm db:migrate, then pnpm dev");
