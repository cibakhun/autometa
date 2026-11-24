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
      // A search page sends up to five queries at once (results, count, facets, the notice above).
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      // Postgres compiles queries it estimates as expensive to machine code (JIT). The search's
      // estimates count every listing although it mostly reads one page in index order, and
      // compiling took up to 1.2 s for a query that ran in 0.1 s. The pool waits for this before
      // handing out a new connection.
      onConnect: async (client) => {
        await client.query("set jit = off");
      },
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
