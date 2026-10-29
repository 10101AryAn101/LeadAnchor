import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config/env";
import * as schema from "./schema";

/**
 * Two connection pools:
 *  - appDb:    role `leadanchor_app`, subject to row-level security. All tenant data goes through withTenant().
 *  - systemDb: role `leadanchor_system` (BYPASSRLS). Only for routing lookups before a tenant is known
 *              (inbound number → business, intake token → business), auth tables and background jobs.
 */
const appPool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
const systemPool = new pg.Pool({ connectionString: env.DATABASE_SYSTEM_URL, max: 10 });

export const appDb = drizzle({ client: appPool, schema });
export const systemDb = drizzle({ client: systemPool, schema });

export type Db = typeof systemDb;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Runs `fn` in a transaction where Postgres only exposes rows of `tenantId` (RLS). */
export function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return appDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

export async function pingDatabase() {
  await systemDb.execute(sql`select 1`);
}

export async function closeDatabase() {
  await Promise.allSettled([appPool.end(), systemPool.end()]);
}

export { schema };
