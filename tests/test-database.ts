import { Pool } from "pg";

/**
 * Connects to TEST_DATABASE_URL and empties its public schema. Refuses any database without
 * "test" in its name, so no suite can wipe a real database, whichever suite runs alone.
 */
export async function emptyTestDatabase(): Promise<Pool> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.includes("test")) throw new Error("TEST_DATABASE_URL must point to a *test* database");
  const pool = new Pool({ connectionString: url });
  await pool.query("drop schema public cascade; create schema public;");
  return pool;
}
