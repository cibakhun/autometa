import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

export const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/**
 * Applies every .sql file in supabase/migrations that has not run yet, in name order.
 * Applied versions are recorded in autometa_migrations.
 */
export async function migrate(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  await pool.query(
    "create table if not exists autometa_migrations (version text primary key, applied_at timestamptz not null default now())",
  );
  const applied = new Set(
    (await pool.query<{ version: string }>("select version from autometa_migrations")).rows.map((r) => r.version),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into autometa_migrations (version) values ($1)", [version]);
      await client.query("commit");
      ran.push(version);
    } catch (error) {
      await client.query("rollback");
      throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }
  return ran;
}
