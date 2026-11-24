import {
  ageBucketLabel,
  bucketYears,
  compareWithAverage,
  COMPONENT_INFO,
  WINDOW_MONTHS,
  type HiddenRisk,
} from "@/core/defects";
import type { RepairJob } from "@/core/repairs";
import { formatEuro, formatNumber } from "@/lib/format";
import type { ModelFile } from "@/search/defects";

const percent = (share: number) => `${Math.round(share * 100)} %`;

/** Jobs every flip has, or too vague for a how-to video. */
const NO_VIDEO_JOBS = new Set(["prep", "hu_prep", "diagnosis", "project", "unknown_defect", "paint", "alignment"]);

/** The short name of a job for a search: "Unfallschaden: Anbauteile tauschen (...)" -> "Unfallschaden". */
const jobSearchName = (label: string) => label.split(/[(:,]/)[0].trim();

const search = (base: string, query: string) => `${base}${encodeURIComponent(query).replace(/%20/g, "+")}`;

export interface ModelFileProps {
  makeName: string;
  modelName: string;
  file: ModelFile;
  /** The car's repair jobs, for how-to video links. */
  jobs: RepairJob[];
  /** The hidden-defect risk as the flip estimate uses it (repair jobs' components left out). */
  risk: HiddenRisk | null;
}

/**
 * The "Modell-Akte": how often this model at this age had defects at the Dutch periodic
 * inspection compared with the average car of its age, and links to more about the model.
 */
export function ModelFileSection({ makeName, modelName, file, jobs, risk }: ModelFileProps) {
  const name = `${makeName} ${modelName}`;
  const [fromYear, toYear] = bucketYears(file.bucket, file.refreshedAt ? new Date(file.refreshedAt) : new Date());
  const rows = file.profile ? compareWithAverage(file.profile, file.average).filter((row) => row.rate >= 0.01) : [];
  const weak = rows.filter((row) => row.weak);
  const videoJobs = jobs.filter((job) => !NO_VIDEO_JOBS.has(job.id));

  return (
    <section className="mt-6 border-t border-line pt-5 text-sm">
      <h2 className="text-base font-semibold">
        Modell-Akte: {name}, {ageBucketLabel(file.bucket)}
      </h2>
      {file.profile ? (
        <>
          <p className="mt-1">
            Von {formatNumber(file.profile.sample)} {name} mit Erstzulassung {fromYear} bis {toYear} in den Niederlanden hatten{" "}
            <span className="font-semibold">{percent(file.profile.anyDefect / file.profile.sample)}</span> bei der Hauptuntersuchung der
            letzten {WINDOW_MONTHS} Monate mindestens einen Mangel
            {file.average && <> (gleich alte Autos im Schnitt {percent(file.average.anyDefect / file.average.sample)})</>}.
          </p>
          {weak.length > 0 ? (
            <p className="mt-1">
              <span className="font-medium text-warn-text">Häufiger als bei anderen Autos:</span>{" "}
              {weak.map((row) => COMPONENT_INFO[row.component].label).join(", ")}.
            </p>
          ) : (
            file.average && <p className="mt-1 text-muted">Keine Baugruppe fällt deutlich häufiger auf als beim Durchschnitt.</p>
          )}
          {rows.length > 0 && (
            // Narrow enough for a phone: the labels wrap, the shares stay in their columns.
            <table className="mt-2 w-full text-left text-sm">
              <caption className="sr-only">
                Anteil mit Mängeln je Baugruppe: {name} und alle gleich alten Autos
              </caption>
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    Mängel an
                  </th>
                  <th scope="col" className="w-px whitespace-nowrap py-1.5 pr-3 text-right font-medium">
                    {modelName}
                  </th>
                  <th scope="col" className="w-px whitespace-nowrap py-1.5 text-right font-medium">
                    Durchschnitt
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.component} className="border-b border-line last:border-0">
                    <th scope="row" className="py-1.5 pr-3 font-normal">
                      {COMPONENT_INFO[row.component].label}
                      {row.weak && (
                        <span className="ml-1.5 inline-block rounded-full border border-warn-line bg-warn-bg px-1.5 text-xs text-warn-text">
                          Schwachstelle
                        </span>
                      )}
                    </th>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-right font-medium">{percent(row.rate)}</td>
                    <td className="whitespace-nowrap py-1.5 text-right text-muted">{row.averageRate === null ? "–" : percent(row.averageRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <p className="mt-1 text-muted">
          Für dieses Modell in diesem Alter gibt es noch keine Mängeldaten
          {file.average ? "; der Risikopuffer rechnet mit dem Durchschnitt gleich alter Autos." : "."}
        </p>
      )}
      {risk && risk.eur > 0 && (
        <p className="mt-2">
          Risikopuffer für versteckte Mängel im Flip-Rechner: <span className="font-medium">ca. {formatEuro(risk.eur)}</span> (Anteil der
          Autos mit Mangel × übliche Teilekosten, ohne die Baugruppen, die die Reparatur schon abdeckt).
        </p>
      )}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <li>
          <a
            href={search("https://www.google.com/search?q=", `site:motor-talk.de ${name} typische Probleme`)}
            target="_blank"
            rel="noopener nofollow"
            className="text-accent hover:underline"
          >
            Erfahrungen im Forum
          </a>
        </li>
        <li>
          <a
            href={search("https://www.google.com/search?q=", `site:adac.de ${name} Mängel Pannenstatistik`)}
            target="_blank"
            rel="noopener nofollow"
            className="text-accent hover:underline"
          >
            ADAC zu Mängeln und Pannen
          </a>
        </li>
        {videoJobs.map((job) => (
          <li key={job.id}>
            <a
              href={search("https://www.youtube.com/results?search_query=", `${name} ${jobSearchName(job.label)} Anleitung`)}
              target="_blank"
              rel="noopener nofollow"
              className="text-accent hover:underline"
            >
              Videos: {jobSearchName(job.label)}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Quelle: Mängel der niederländischen Hauptuntersuchung (APK) und Fahrzeugregister der RDW, offene Daten (CC0)
        {file.refreshedAt && <>, Stand {new Date(file.refreshedAt).toLocaleDateString("de-DE")}</>}. Gezählt sind zugelassene Autos mit
        gültiger HU. Niederländische Zahlen zeigen Tendenzen, keine genauen deutschen Quoten. Die Links führen zu Suchen bei Google und
        YouTube.
      </p>
    </section>
  );
}
