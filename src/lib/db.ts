import { Pool } from "pg";

declare global {
  var __autometaPool: Pool | undefined;
}

/**
 * Shared Postgres pool. Works against local Postgres and Supabase.
 * With Supabase, the pooled connection string (port 6543) is fine here; migrations use their own connection.
 */
export function getPool(): Pool {
  if (!globalThis.__autometaPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
    }
    globalThis.__autometaPool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    });
  }
  return globalThis.__autometaPool;
}

/** Collects positional parameters ($1, $2, ...) while building SQL by hand. */
export class Params {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}
