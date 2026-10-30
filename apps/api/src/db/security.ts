/**
 * Database security that drizzle-kit migrations don't express: login roles,
 * grants, append-only tables and row-level security policies. Applied (idempotently)
 * after every migration run by `pnpm db:migrate`.
 */

/** Tables isolated per business. Each has a tenant_id column (tenants uses its own id). */
export const TENANT_TABLES = [
  "memberships",
  "phone_numbers",
  "customers",
  "services",
  "leads",
  "lead_events",
  "calls",
  "call_events",
  "intake_requests",
  "media_assets",
  "messages",
  "notifications",
  "push_devices",
  "carrier_registrations",
  "consent_ledger",
  "audit_log",
  "payment_accounts",
  "quotes",
  "quote_lines",
  "payment_requests",
  "bookings",
  "waitlist_entries",
  "waitlist_offers",
  "waitlist_offer_recipients",
  "calendar_connections",
  "calendar_events",
] as const;

/** Append-only tables: no UPDATE or DELETE for application roles. */
export const APPEND_ONLY_TABLES = ["consent_ledger", "audit_log"] as const;

const identifier = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
};
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

export interface RoleCredentials {
  user: string;
  password: string;
}

export function securityStatements(opts: {
  database: string;
  app: RoleCredentials;
  system: RoleCredentials;
}): string[] {
  const db = identifier(opts.database);
  const app = identifier(opts.app.user);
  const system = identifier(opts.system.user);

  const statements: string[] = [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(opts.app.user)}) THEN
         CREATE ROLE ${app} LOGIN PASSWORD ${literal(opts.app.password)} NOBYPASSRLS;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(opts.system.user)}) THEN
         CREATE ROLE ${system} LOGIN PASSWORD ${literal(opts.system.password)} BYPASSRLS;
       END IF;
     END $$;`,
    `GRANT CONNECT ON DATABASE ${db} TO ${app}, ${system};`,
    // pg-boss keeps its queue tables in its own schema, created by the system role.
    `GRANT CREATE ON DATABASE ${db} TO ${system};`,
    `GRANT USAGE ON SCHEMA public TO ${app}, ${system};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${app}, ${system};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}, ${system};`,
    `CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
       LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;`,
    `GRANT EXECUTE ON FUNCTION app_current_tenant() TO ${app}, ${system};`,
  ];

  for (const table of APPEND_ONLY_TABLES) {
    statements.push(`REVOKE UPDATE, DELETE ON ${identifier(table)} FROM ${app}, ${system};`);
  }

  // The tenants table is keyed by its own id.
  statements.push(...policy("tenants", "id"));
  for (const table of TENANT_TABLES) statements.push(...policy(table, "tenant_id"));

  return statements;
}

function policy(table: string, column: string): string[] {
  const t = identifier(table);
  const c = identifier(column);
  return [
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS tenant_isolation ON ${t};`,
    `CREATE POLICY tenant_isolation ON ${t}
       USING (${c} = app_current_tenant())
       WITH CHECK (${c} = app_current_tenant());`,
  ];
}

export function credentialsFromUrl(url: string): RoleCredentials & { database: string } {
  const parsed = new URL(url);
  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
  };
}
