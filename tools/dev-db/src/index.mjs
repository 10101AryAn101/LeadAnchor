// Local PostgreSQL for development.
//
// Starts a real PostgreSQL 18 server from the `embedded-postgres` package, so a
// developer only needs Node — no Docker and no system-wide Postgres install.
// Data lives in <repo>/.data/postgres and survives restarts.
//
// Production uses a managed/self-hosted PostgreSQL; nothing in the app depends
// on this runner.

import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDir = resolve(repoRoot, ".data/postgres");

const port = Number(process.env.DEV_DB_PORT ?? 5433);
const database = process.env.DEV_DB_NAME ?? "leadanchor";
const user = "postgres";
const password = process.env.DEV_DB_PASSWORD ?? "postgres";

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
  onLog: () => {},
  onError: (message) => {
    const text = String(message ?? "").trim();
    if (text) console.error(`[dev-db] ${text}`);
  },
});

async function main() {
  const firstRun = !existsSync(resolve(dataDir, "PG_VERSION"));
  if (firstRun) {
    mkdirSync(dirname(dataDir), { recursive: true });
    console.log(`[dev-db] initialising a new cluster in ${dataDir}`);
    await pg.initialise();
  }

  await pg.start();

  try {
    await pg.createDatabase(database);
    console.log(`[dev-db] created database "${database}"`);
  } catch {
    // Already exists — nothing to do.
  }

  console.log(`[dev-db] PostgreSQL ready on postgres://${user}:***@localhost:${port}/${database}`);
}

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[dev-db] ${signal} received, stopping PostgreSQL…`);
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch(async (error) => {
  console.error("[dev-db] failed to start PostgreSQL:", error);
  try {
    await pg.stop();
  } catch {
    // ignore
  }
  process.exit(1);
});

// Keep the process alive while PostgreSQL runs.
setInterval(() => {}, 1 << 30);
