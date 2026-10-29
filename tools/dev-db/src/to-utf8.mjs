// Converts the local development database to UTF-8, keeping its data.
//
// Clusters made before the dev-db runner asked initdb for UTF-8 took the Windows
// default (e.g. WIN1252), which can't store emoji or many symbols. This script:
//   1. renames the old database to <name>_old_<encoding> (kept as a backup),
//   2. creates a fresh UTF-8 database with the same name and runs the API's
//      migrations on it (schema, roles, grants and row-level security),
//   3. copies every table across and checks the row counts,
//   4. rebuilds template1 as UTF-8, so databases created later are UTF-8 too.
// If a step fails, the new database is dropped and the original is put back.
// pg-boss's queue tables are not copied: the API recreates them on start.
//
// Run with the dev database running and the API stopped:  pnpm db:utf8

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const database = process.env.DEV_DB_NAME ?? "leadanchor";
const UTF8 = "ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8' LOCALE 'C'";

// Only used to build clients with the cluster's settings; nothing is started here.
const cluster = new EmbeddedPostgres({
  databaseDir: resolve(repoRoot, ".data/postgres"),
  user: "postgres",
  password: process.env.DEV_DB_PASSWORD ?? "postgres",
  port: Number(process.env.DEV_DB_PORT ?? 5433),
  persistent: true,
});

async function connect(name) {
  const client = cluster.getPgClient(name, "localhost");
  await client.connect();
  return client;
}

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

async function main() {
  const admin = await connect("postgres");
  try {
    const [row] = (
      await admin.query("select pg_encoding_to_char(encoding) as encoding from pg_database where datname = $1", [database])
    ).rows;
    if (!row) throw new Error(`There is no "${database}" database. Start the dev database first (pnpm db:start).`);
    if (row.encoding === "UTF8") {
      console.log(`[to-utf8] "${database}" is already UTF-8. Nothing to do.`);
      return;
    }

    const others = (
      await admin.query("select count(*)::int as n from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [database])
    ).rows[0].n;
    if (others > 0) throw new Error(`${others} connection(s) are open to "${database}". Stop the API (and anything else using it), then run this again.`);

    const backup = `${database}_old_${row.encoding.toLowerCase()}`;
    console.log(`[to-utf8] "${database}" uses ${row.encoding}. Keeping it as "${backup}" and building a UTF-8 copy.`);
    await admin.query(`DROP DATABASE IF EXISTS ${quote(backup)}`);
    await admin.query(`ALTER DATABASE ${quote(database)} RENAME TO ${quote(backup)}`);

    try {
      await admin.query(`CREATE DATABASE ${quote(database)} WITH TEMPLATE template0 ${UTF8}`);
      migrate();
      await copyTables(backup);
    } catch (error) {
      console.error("[to-utf8] something failed, putting the original database back.");
      await admin.query(`DROP DATABASE IF EXISTS ${quote(database)} WITH (FORCE)`);
      await admin.query(`ALTER DATABASE ${quote(backup)} RENAME TO ${quote(database)}`);
      throw error;
    }

    await rebuildTemplate(admin);
    console.log(`[to-utf8] done. "${database}" is UTF-8 now; the old copy stays as "${backup}" until you drop it.`);
  } finally {
    await admin.end();
  }
}

/** The API's own migrations build the schema, roles, grants and row-level security. */
function migrate() {
  console.log("[to-utf8] running the API migrations on the new database…");
  // Same roles and passwords as the API uses, pointed at the database being converted.
  const envFile = resolve(repoRoot, "apps/api/.env");
  const apiEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
  const defaults = {
    DATABASE_URL: "postgres://leadanchor_app:leadanchor_app@localhost:5433/leadanchor",
    DATABASE_SYSTEM_URL: "postgres://leadanchor_system:leadanchor_system@localhost:5433/leadanchor",
    DATABASE_ADMIN_URL: "postgres://postgres:postgres@localhost:5433/leadanchor",
  };
  const urls = Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => {
      const url = new URL(process.env[key] ?? apiEnv[key] ?? fallback);
      url.pathname = `/${database}`;
      return [key, url.toString()];
    }),
  );
  const result = spawnSync("pnpm", ["--filter", "@leadanchor/api", "db:migrate"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...urls },
  });
  if (result.status !== 0) throw new Error("The API migrations failed on the new database.");
}

async function copyTables(backup) {
  const from = await connect(backup);
  const to = await connect(database);
  try {
    const tables = (
      await from.query("select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")
    ).rows.map((table) => table.name);
    const present = new Set(
      (await to.query("select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")).rows.map(
        (table) => table.name,
      ),
    );

    await to.query("BEGIN");
    // Skip foreign-key checks and triggers while copying (superuser only), so table order doesn't matter.
    await to.query("SET LOCAL session_replication_role = replica");
    const counts = [];
    for (const table of tables) {
      if (!present.has(table)) {
        console.warn(`[to-utf8] skipping "${table}": the migrations don't create it.`);
        continue;
      }
      const columns = (
        await to.query(
          "select column_name as name from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER' order by ordinal_position",
          [table],
        )
      ).rows.map((column) => quote(column.name));
      const target = `public.${quote(table)}`;
      // Read as JSON text: the server converts it from the old encoding on the way out.
      const rows = (await from.query(`select coalesce(json_agg(t), '[]')::text as rows from ${target} t`)).rows[0].rows;
      await to.query(
        `insert into ${target} (${columns.join(", ")}) overriding system value select ${columns.join(", ")} from json_populate_recordset(null::${target}, $1::json)`,
        [rows],
      );
      counts.push({ table, rows: JSON.parse(rows).length });
    }
    await to.query("COMMIT");

    // Sequences behind any serial columns continue after the copied rows.
    const sequences = (
      await to.query(`select c.relname as table_name, a.attname as column_name, pg_get_serial_sequence(quote_ident(c.relname), a.attname) as sequence
         from pg_class c join pg_attribute a on a.attrelid = c.oid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and pg_get_serial_sequence(quote_ident(c.relname), a.attname) is not null`)
    ).rows;
    for (const s of sequences) {
      await to.query(`select setval($1, coalesce((select max(${quote(s.column_name)}) from public.${quote(s.table_name)}), 0) + 1, false)`, [s.sequence]);
    }

    for (const { table, rows } of counts) {
      const copied = (await to.query(`select count(*)::int as n from public.${quote(table)}`)).rows[0].n;
      if (copied !== rows) throw new Error(`"${table}": copied ${copied} of ${rows} rows.`);
    }
    console.log(`[to-utf8] copied ${counts.reduce((sum, c) => sum + c.rows, 0)} rows from ${counts.length} tables.`);
  } catch (error) {
    await to.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await from.end();
    await to.end();
  }
}

/** Databases created later (e.g. by the dev-db runner) copy template1, so make it UTF-8 too. */
async function rebuildTemplate(admin) {
  const [row] = (await admin.query("select pg_encoding_to_char(encoding) as encoding from pg_database where datname = 'template1'")).rows;
  if (row?.encoding === "UTF8") return;
  await admin.query("UPDATE pg_database SET datistemplate = false WHERE datname = 'template1'");
  await admin.query("DROP DATABASE template1");
  try {
    await admin.query(`CREATE DATABASE template1 WITH TEMPLATE template0 ${UTF8} IS_TEMPLATE true`);
  } catch (error) {
    // Never leave the cluster without a template1.
    await admin.query("CREATE DATABASE template1 WITH TEMPLATE template0 IS_TEMPLATE true");
    throw error;
  }
  console.log("[to-utf8] template1 is UTF-8 now.");
}

main().catch((error) => {
  console.error(`[to-utf8] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
