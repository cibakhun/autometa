import "./env";
import { getPool } from "@/lib/db";
import { ADAPTERS } from "@/ingest/adapters";
import { runIngest } from "@/ingest/run";

const sourceIds = process.argv.slice(2);
if (sourceIds.length === 0) {
  console.error(`Usage: npm run ingest -- <source...>   (known: ${Object.keys(ADAPTERS).join(", ")})`);
  process.exit(1);
}

async function main() {
  const pool = getPool();
  try {
    for (const id of sourceIds) {
      const create = ADAPTERS[id];
      if (!create) throw new Error(`Unknown source "${id}". Known: ${Object.keys(ADAPTERS).join(", ")}`);
      const started = Date.now();
      const result = await runIngest(pool, create());
      console.log(
        `${id}: fetched ${result.fetched}, stored ${result.upserted}, skipped ${result.skipped}, gone ${result.gone} (${Date.now() - started} ms)`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
