import "./env";
import { Pool } from "pg";
import { migrate } from "@/ingest/migrate";
import { migrationConnectionString } from "@/ingest/migration-connection";

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
