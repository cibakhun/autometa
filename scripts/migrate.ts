import "./env";
import { getPool } from "@/lib/db";
import { migrate } from "@/ingest/migrate";

async function main() {
  const pool = getPool();
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
