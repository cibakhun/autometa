import "./env";
import { getPool } from "@/lib/db";
import { refreshDefectProfiles } from "@/ingest/defects/refresh";
import { updateRepairEstimates } from "@/ingest/repairs";

/** One run of the defect profile refresh (normally done by the worker), then the risk buffers. */
async function main() {
  const pool = getPool();
  try {
    const result = await refreshDefectProfiles(pool);
    console.log(`Defect profiles: ${result.profiles} written, ${result.pending} still due, ${result.requests} requests.`);
    if (result.error) console.log(`Stopped with an error: ${result.error}`);
    console.log(`Repair estimates: ${await updateRepairEstimates(pool)} changed.`);
    if (result.error) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
