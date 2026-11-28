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
import { Fold, HowItWorks } from "./fold";

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
  className?: string;
}

/**
 * The "Modell-Akte": how often this model at this age had defects at the Dutch periodic
 * inspection compared with the average car of its age, and links to more about the model.
 */
export function ModelFileSection({ makeName, modelName, file, jobs, risk, className = "" }: ModelFileProps) {
  const name = `${makeName} ${modelName}`;
  const [fromYear, toYear] = bucketYears(file.bucket, file.refreshedAt ? new Date(file.refreshedAt) : new Date());
  const rows = file.profile ? compareWithAverage(file.profile, file.average).filter((row) => row.rate >= 0.01) : [];
  const weak = rows.filter((row) => row.weak);
  const videoJobs = jobs.filter((job) => !NO_VIDEO_JOBS.has(job.id));

  const modelShare = file.profile ? file.profile.anyDefect / file.profile.sample : null;
  const averageShare = file.average ? file.average.anyDefect / file.average.sample : null;

  return (
    <section className={`text-sm ${className}`} aria-labelledby="model-file-heading">
      <h2 id="model-file-heading" className="text-base font-semibold">
        Modell-Akte: {name}
      </h2>
      <p className="text-xs text-muted">
        Erstzulassung {fromYear} bis {toYear} ({ageBucketLabel(file.bucket)}), Mängel bei der Hauptuntersuchung
      </p>
      {file.profile && modelShare !== null ? (
        <>
          <div className="mt-3 space-y-1.5" role="img" aria-label={`${percent(modelShare)} der ${name} mit Mangel bei der HU${averageShare !== null ? `, gleich alte Autos im Schnitt ${percent(averageShare)}` : ""}`}>
            <ShareBar label={modelName} share={modelShare} tone={averageShare === null ? "plain" : modelShare <= averageShare * 0.95 ? "good" : modelShare >= averageShare * 1.05 ? "warn" : "plain"} />
            {averageShare !== null && <ShareBar label="Durchschnitt" share={averageShare} tone="muted" />}
          </div>
          <p className="mt-2">
            <span className="font-semibold">{percent(modelShare)}</span> der {formatNumber(file.profile.sample)} geprüften {name} hatten bei der HU der
            letzten {WINDOW_MONTHS} Monate mindestens einen Mangel
            {averageShare !== null && <>, gleich alte Autos im Schnitt {percent(averageShare)}</>}.
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
            <Fold className="mt-3 border-t border-line pt-2" title="Mängel je Baugruppe" aside={`${rows.length} Baugruppen`}>
              {/* Narrow enough for a phone: the labels wrap, the shares stay in their columns. */}
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  Anteil mit Mängeln je Baugruppe: {name} und alle gleich alten Autos
                </caption>
                <thead className="text-xs text-muted">
                  <tr className="border-b border-line">
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Mängel an
                    </th>
                    <th scope="col" className="w-px py-1.5 pr-3 text-right font-medium">
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
            </Fold>
          )}
        </>
      ) : (
        <p className="mt-2 text-muted">
          Für dieses Modell in diesem Alter gibt es noch keine Mängeldaten
          {file.average ? "; der Risikopuffer rechnet mit dem Durchschnitt gleich alter Autos." : "."}
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
      <HowItWorks label="Woher kommen die Zahlen?">
        <p>
          Quelle: Mängel der niederländischen Hauptuntersuchung (APK) und Fahrzeugregister der RDW, offene Daten (CC0)
          {file.refreshedAt && <>, Stand {new Date(file.refreshedAt).toLocaleDateString("de-DE")}</>}. Gezählt sind zugelassene Autos mit
          gültiger HU. Niederländische Zahlen zeigen Tendenzen, keine genauen deutschen Quoten. Die Links führen zu Suchen bei Google und
          YouTube.
        </p>
        {risk && risk.eur > 0 && (
          <p>
            Risikopuffer für versteckte Mängel im Flip-Rechner: ca. {formatEuro(risk.eur)}, der Anteil der Autos mit Mangel × übliche
            Teilekosten, ohne die Baugruppen, die die Reparatur schon abdeckt.
          </p>
        )}
      </HowItWorks>
    </section>
  );
}

const BAR_TONES = { good: "bg-good-text", warn: "bg-warn-text", plain: "bg-accent", muted: "bg-muted/50" } as const;

/** One horizontal bar: the share of cars with a defect at the inspection. */
function ShareBar({ label, share, tone }: { label: string; share: number; tone: keyof typeof BAR_TONES }) {
  return (
    <div className="flex items-center gap-2 text-xs" aria-hidden="true">
      <span className="w-24 shrink-0 truncate text-muted">{label}</span>
      <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-background ring-1 ring-line">
        <span className={`block h-full rounded-full ${BAR_TONES[tone]}`} style={{ width: `${Math.min(share, 1) * 100}%` }} />
      </span>
      <span className="w-9 shrink-0 text-right font-medium">{percent(share)}</span>
    </div>
  );
}
