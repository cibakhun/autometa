import "./env";
import { Pool } from "pg";
import { migrate } from "@/ingest/migrate";

/**
 * Migrations hold a session-level advisory lock across transactions, so they need a direct
 * or session-mode connection. A transaction pooler (Supabase port 6543) cannot keep that lock.
 */
function migrationConnectionString(): string {
  const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  }
  if (new URL(connectionString).port === "6543") {
    throw new Error(
      "Migrations need a direct or session-mode connection, not the transaction pooler on port 6543. " +
        "Set MIGRATION_DATABASE_URL to the direct connection string (port 5432).",
    );
  }
  return connectionString;
}

async function main() {
  const pool = new Pool({ connectionString: migrationConnectionString(), max: 1 });
  try {
    const ran = await migrate(pool);
    console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
