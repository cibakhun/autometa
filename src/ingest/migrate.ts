import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

export const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/** Advisory lock key, so two migration runs (e.g. two deploys) never apply the same file twice. */
const MIGRATION_LOCK_KEY = 726_284_311;

/**
 * Applies every .sql file in supabase/migrations that has not run yet, in name order.
 * Applied versions are recorded in autometa_migrations. The whole run holds a
 * session-level advisory lock on one connection, so concurrent runs wait for each other.
 */
export async function migrate(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    locked = true;
    await client.query(
      "create table if not exists autometa_migrations (version text primary key, applied_at timestamptz not null default now())",
    );
    const applied = new Set(
      (await client.query<{ version: string }>("select version from autometa_migrations")).rows.map((r) => r.version),
    );
    const ran: string[] = [];

    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (applied.has(version)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into autometa_migrations (version) values ($1)", [version]);
        await client.query("commit");
        ran.push(version);
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return ran;
  } finally {
    try {
      if (locked) await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}
