import { connection } from "next/server";
import { getPool } from "@/lib/db";
import { formatDayTime, formatShare } from "@/lib/format";
import { getSourceStatus, type SourceStatus } from "@/search/query";

const berlinDay = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });
const berlinTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

const berlinDate = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" });

/** A source's last import as short as it stays clear: "02:43" today, "gestern 18:10", else "21.11." (the time is in the tooltip). */
function shortStand(iso: string, now: Date): string {
  const date = new Date(iso);
  const day = berlinDay.format(date);
  if (day === berlinDay.format(now)) return berlinTime.format(date);
  if (day === berlinDay.format(new Date(now.getTime() - 24 * 3600_000))) return `gestern ${berlinTime.format(date)}`;
  return berlinDate.format(date);
}

/** Worth a second look: no import for a day, or less than half of the listings checked in 24 hours. */
const lagging = (source: SourceStatus, now: Date) =>
  (source.lastImportAt !== null && now.getTime() - Date.parse(source.lastImportAt) > 24 * 3600_000) ||
  (source.checkedShare !== null && source.checkedShare < 0.5);

/**
 * The line under the header: demo warning, or which portals the listings come from, how fresh they
 * are and what share of each portal's listings was seen or confirmed in the last 24 hours, as one
 * small chip per portal that wraps on phones.
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

  const now = new Date();
  return (
    <div className="border-b border-line bg-surface">
      {/* Phones: two narrow columns of plain text; wider screens: one row of chips. */}
      <div className="mx-auto max-w-7xl px-4 py-2 text-[11px] sm:flex sm:flex-wrap sm:items-center sm:gap-1.5 sm:text-xs">
        <p className="mb-0.5 text-muted sm:mb-0 sm:mr-1">
          <span className="font-medium text-foreground">Datenstand</span> (Stand · in 24 h geprüft):
        </p>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:flex sm:flex-wrap sm:gap-1.5">
          {sources.map((source) => {
            const stand = source.lastImportAt ? shortStand(source.lastImportAt, now) : null;
            const share = source.checkedShare !== null ? formatShare(source.checkedShare) : null;
            const details = [
              source.lastImportAt && `Stand ${formatDayTime(source.lastImportAt)}`,
              share && `${share} der Angebote in den letzten 24 h geprüft`,
            ].filter(Boolean);
            const warn = lagging(source, now);
            return (
              <li
                key={source.id}
                title={details.length > 0 ? `${source.name}: ${details.join(", ")}` : source.name}
                className={`truncate sm:rounded-full sm:border sm:px-2 sm:py-0.5 ${
                  warn ? "text-warn-text sm:border-warn-line sm:bg-warn-bg" : "text-muted sm:border-line sm:bg-background"
                }`}
              >
                <span className={`font-medium ${warn ? "" : "text-foreground"}`}>{source.name}</span>{" "}
                {[stand, share].filter(Boolean).join(" · ")}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
