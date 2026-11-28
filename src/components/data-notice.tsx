import { connection } from "next/server";
import { getPool } from "@/lib/db";
import { formatDayTime, formatShare } from "@/lib/format";
import { getSourceStatus, type SourceStatus } from "@/search/query";
import { Chevron } from "./fold";

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
 * The line under the header: demo warning, or in one sentence how many portals the listings come
 * from, how fresh they are and what share was seen or confirmed in the last 24 hours, with a
 * warning when a portal lags. The numbers per portal open on a tap.
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
  const counted = sources.filter((source) => source.checkedShare !== null && (source.activeListings ?? 0) > 0);
  const total = counted.reduce((sum, source) => sum + source.activeListings!, 0);
  const overall = total > 0 ? counted.reduce((sum, source) => sum + source.checkedShare! * source.activeListings!, 0) / total : null;
  const latest = sources.reduce<string | null>((last, source) => (source.lastImportAt && (!last || source.lastImportAt > last) ? source.lastImportAt : last), null);
  const behind = sources.filter((source) => lagging(source, now));
  return (
    <div className="border-b border-line bg-surface">
      {/* One plain sentence; the numbers per portal open on a tap. */}
      <details className="mx-auto max-w-7xl px-4 text-xs">
        <summary className="fold flex cursor-pointer select-none items-center gap-2 py-2 text-muted hover:text-accent">
          <span className={`h-2 w-2 shrink-0 rounded-full ${behind.length > 0 ? "bg-warn-text" : "bg-good-text"}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-medium text-foreground">Datenstand:</span> {sources.length} {sources.length === 1 ? "Börse" : "Börsen"}
            {latest && <>, zuletzt aktualisiert {shortStand(latest, now)}</>}
            {overall !== null && <>, {formatShare(overall)} der Angebote in 24&nbsp;h geprüft</>}
            {behind.length > 0 && (
              <span className="text-warn-text">
                {" "}
                · {behind.map((source) => source.name).join(", ")} {behind.length === 1 ? "hängt" : "hängen"} hinterher
              </span>
            )}
          </span>
          <Chevron className="h-3.5 w-3.5" />
        </summary>
        <ul className="flex flex-wrap gap-1.5 pb-2">
          {sources.map((source) => {
            const share = source.checkedShare !== null ? formatShare(source.checkedShare) : null;
            const details = [source.lastImportAt && `Stand ${formatDayTime(source.lastImportAt)}`, share && `${share} in 24 h geprüft`].filter(Boolean);
            const warn = lagging(source, now);
            return (
              <li
                key={source.id}
                className={`rounded-full border px-2 py-0.5 ${warn ? "border-warn-line bg-warn-bg text-warn-text" : "border-line bg-background text-muted"}`}
              >
                <span className={`font-medium ${warn ? "" : "text-foreground"}`}>{source.name}</span>
                {details.length > 0 && <> · {details.join(" · ")}</>}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
