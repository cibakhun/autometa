import "./env";
import { getPool } from "@/lib/db";
import { prepareData } from "@/ingest/prepare";

async function main() {
  const pool = getPool();
  try {
    const { reference, demo } = await prepareData(pool);
    console.log(
      `Reference data: ${reference.makes} makes, ${reference.models} models, ${reference.postalCodes} postal codes.`,
    );
    console.log(demo ? `Empty database: imported ${demo.upserted} demo listings.` : "Listings present, demo import skipped.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
