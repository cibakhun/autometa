import "./env";
import { getPool } from "@/lib/db";
import { ADAPTERS } from "@/ingest/adapters";
import { ingestSources } from "@/ingest/pipeline";

const sourceIds = process.argv.slice(2);
if (sourceIds.length === 0) {
  console.error(`Usage: npm run ingest -- <source...>   (known: ${Object.keys(ADAPTERS).join(", ")})`);
  process.exit(1);
}

async function main() {
  const pool = getPool();
  try {
    const { sources } = await ingestSources(pool, sourceIds);
    if (sources.some((s) => s.error)) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
