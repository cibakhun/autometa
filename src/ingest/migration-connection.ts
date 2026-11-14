import { parse } from "pg-connection-string";

type Env = Record<string, string | undefined>;

/** Supabase's transaction pooler. It hands each transaction to a different server session. */
const TRANSACTION_POOLER_PORT = "6543";

/**
 * Picks the connection string for migrations. They hold a session-level advisory lock across
 * transactions, so they need a direct or session-mode connection: a transaction pooler cannot
 * keep that lock.
 */
export function migrationConnectionString(env: Env = process.env): string {
  const connectionString = env.MIGRATION_DATABASE_URL || env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  }
  if (effectivePort(connectionString, env) === TRANSACTION_POOLER_PORT) {
    throw new Error(
      `Migrations need a direct or session-mode connection, not the transaction pooler on port ${TRANSACTION_POOLER_PORT}. ` +
        "Set MIGRATION_DATABASE_URL to the direct connection string (port 5432).",
    );
  }
  return connectionString;
}

/**
 * The port pg will connect to. pg reads the string with this same parser, so a ?port= parameter,
 * a URL without a host and a Unix socket path resolve as they will at connect time. When the
 * string names no port, pg falls back to PGPORT. The parser redacts the input from its errors,
 * so a malformed string can't put the password into startup logs.
 */
function effectivePort(connectionString: string, env: Env): string | undefined {
  return parse(connectionString).port || env.PGPORT || undefined;
}
