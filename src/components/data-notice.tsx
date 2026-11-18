import { connection } from "next/server";
import { getPool } from "@/lib/db";
import { getSourceStatus, type SourceStatus } from "@/search/query";

/** The line under the header: demo warning, or which portals the listings come from and how fresh they are. */
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
            {source.lastImportAt && <> (Stand {formatStand(source.lastImportAt)})</>}
          </span>
        ))}
      </p>
    </div>
  );
}

const STAND = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

/** "15.11., 18:04" in German time. */
export function formatStand(iso: string): string {
  return STAND.format(new Date(iso));
}
