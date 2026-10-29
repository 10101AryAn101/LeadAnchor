import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { env } from "../config/env";
import { credentialsFromUrl, securityStatements } from "./security";

/**
 * 1. Applies drizzle migrations (./drizzle) as the admin role.
 * 2. Re-applies roles, grants and row-level security (idempotent).
 */
async function main() {
  const admin = new pg.Client({ connectionString: env.DATABASE_ADMIN_URL });
  await admin.connect();

  try {
    console.log("→ applying schema migrations");
    await migrate(drizzle({ client: admin }), { migrationsFolder: "./drizzle" });

    console.log("→ applying roles, grants and row-level security");
    const app = credentialsFromUrl(env.DATABASE_URL);
    const system = credentialsFromUrl(env.DATABASE_SYSTEM_URL);
    for (const statement of securityStatements({ database: app.database, app, system })) {
      await admin.query(statement);
    }

    console.log("✓ database is up to date");
  } finally {
    await admin.end();
  }
}

main().catch((error) => {
  console.error("✖ migration failed:", error);
  process.exit(1);
});
