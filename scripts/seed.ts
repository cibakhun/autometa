import "./env";
import { getPool } from "@/lib/db";
import { seedReferenceData } from "@/ingest/seed";

async function main() {
  const pool = getPool();
  try {
    const counts = await seedReferenceData(pool);
    console.log(`Seeded ${counts.makes} makes, ${counts.models} models, ${counts.postalCodes} postal codes.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
