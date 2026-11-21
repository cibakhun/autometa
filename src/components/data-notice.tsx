import { connection } from "next/server";
import { getPool } from "@/lib/db";
import { formatDayTime, formatShare } from "@/lib/format";
import { getSourceStatus, type SourceStatus } from "@/search/query";

/**
 * The line under the header: demo warning, or which portals the listings come from, how fresh they
 * are and what share of each portal's listings was seen or confirmed in the last 24 hours.
 */
export async function DataNotice() {
  await connection();
  let sources: SourceStatus[];
  try {
    sources = await getSourceStatus(getPool());
  } catch {
    return null;
  }
  if (sources.length === 0) return null;

  if (sources.some((source) => source.kind === "demo")) {
    return (
      <div className="border-b border-warn-line bg-warn-bg">
        <p className="mx-auto max-w-7xl px-4 py-2 text-sm text-warn-text">
          Demo-Modus: Alle Fahrzeuge sind generierte Testdaten, keine echten Angebote.
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-line bg-surface">
      <p className="mx-auto max-w-7xl px-4 py-2 text-sm text-muted">
        Angebote von{" "}
        {sources.map((source, i) => (
          <span key={source.id}>
            {i > 0 && (i === sources.length - 1 ? " und " : ", ")}
            <span className="font-medium text-foreground">{source.name}</span>
            {(source.lastImportAt || source.checkedShare !== null) && (
              <>
                {" ("}
                {[
                  source.lastImportAt && `Stand ${formatDayTime(source.lastImportAt)}`,
                  source.checkedShare !== null && `${formatShare(source.checkedShare)} in 24 h geprüft`,
                ]
                  .filter(Boolean)
                  .join(", ")}
                {")"}
              </>
            )}
          </span>
        ))}
      </p>
    </div>
  );
}
