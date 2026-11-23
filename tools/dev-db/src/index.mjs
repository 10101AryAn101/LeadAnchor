// Local PostgreSQL for development.
//
// Starts a real PostgreSQL 18 server from the `embedded-postgres` package, so a
// developer only needs Node — no Docker and no system-wide Postgres install.
// Data lives in <repo>/.data/postgres and survives restarts. New clusters are
// UTF-8 (Windows would otherwise pick a code page like WIN1252, which can't
// store emoji); `pnpm db:utf8` converts a cluster made before that.
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
  initdbFlags: ["--encoding=UTF8", "--locale=C", "--locale-provider=builtin", "--builtin-locale=C.UTF-8"],
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
  await warnIfNotUtf8();
}

async function warnIfNotUtf8() {
  const client = pg.getPgClient("postgres", "localhost");
  try {
    await client.connect();
    const { rows } = await client.query("select pg_encoding_to_char(encoding) as encoding from pg_database where datname = $1", [database]);
    if (rows[0] && rows[0].encoding !== "UTF8") {
      console.warn(
        `[dev-db] "${database}" uses ${rows[0].encoding}, so emoji and some symbols can't be saved. ` +
          "Stop the API and run `pnpm db:utf8` to convert it (your data is kept).",
      );
    }
  } catch {
    // Only a hint; never stop the database over it.
  } finally {
    await client.end().catch(() => {});
  }
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
