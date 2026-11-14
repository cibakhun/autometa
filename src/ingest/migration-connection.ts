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
  if (connectionPort(connectionString) === TRANSACTION_POOLER_PORT) {
    throw new Error(
      `Migrations need a direct or session-mode connection, not the transaction pooler on port ${TRANSACTION_POOLER_PORT}. ` +
        "Set MIGRATION_DATABASE_URL to the direct connection string (port 5432).",
    );
  }
  return connectionString;
}

/** The URL's port, or undefined for forms pg accepts that are not URLs, such as Unix socket paths. */
function connectionPort(connectionString: string): string | undefined {
  try {
    return new URL(connectionString).port;
  } catch {
    // Not rethrown: Node keeps the whole input, password included, on the error, and startup
    // logs would print it. pg reports an invalid string itself, with the input redacted.
    return undefined;
  }
}
