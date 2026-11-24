import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { DAMAGE_LABELS, type DamageKind } from "@/core/damage";
import { AGE_BUCKETS, COMPONENT_INFO, DEFECT_COMPONENTS, MIN_SAMPLE, WINDOW_MONTHS } from "@/core/defects";
import {
  CLASS_FACTORS,
  CONFIDENCE_LABELS,
  DAMAGE_JOBS,
  DIFFICULTY_LABELS,
  findJob,
  JOB_GROUPS,
  REPAIR_JOBS,
  LABOR_AND_HASSLE_EUR,
  SEVERE_CASES,
  SEVERE_CERTAIN,
  SEVERE_FROM,
  VEHICLE_CLASS_LABELS,
  VEHICLE_CLASSES,
  type Difficulty,
} from "@/core/repairs";
import { getPool } from "@/lib/db";
import { formatEuro, formatNumber } from "@/lib/format";
import { getDefectDataStatus } from "@/search/defects";

export const metadata: Metadata = { title: "Reparaturkatalog – AutoMeta" };

const hours = ([from, to]: [number, number]) =>
  `${from.toLocaleString("de-DE")}${from === to ? "" : `–${to.toLocaleString("de-DE")}`} h`;
const euros = ([from, to]: [number, number]) => (from === to ? formatEuro(from) : `${formatEuro(from)} – ${formatEuro(to)}`);

export default function RepairCatalogPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reparaturkatalog</h1>
        <p className="mt-2 text-sm text-muted">
          Typische Arbeiten beim Flippen, mit Stunden für einen Hobbyschrauber mit normalem Werkzeug und Teilepreisen aus Zubehör
          oder vom Verwerter. <strong className="font-semibold text-foreground">Alle Werte sind Schätzungen</strong>, keine
          Herstellerzeiten; sie werden mit echten Flips genauer.
        </p>
      </div>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Schwierigkeit</h2>
        <ol className="mt-2 space-y-1 text-sm">
          {(Object.entries(DIFFICULTY_LABELS) as unknown as [Difficulty, string][]).map(([level, label]) => (
            <li key={level}>
              <span className="font-medium">{level}</span> {label}
            </li>
          ))}
        </ol>
        <h2 className="mt-4 font-semibold">Teilepreise nach Fahrzeugklasse</h2>
        <p className="mt-1 text-sm text-muted">
          Die Preise unten gelten für die Kompaktklasse. Die Klasse ergibt sich aus Leistung und Fahrzeugtyp, Premiummarken eine
          Klasse höher.
        </p>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {VEHICLE_CLASSES.map((cls) => (
            <li key={cls}>
              {VEHICLE_CLASS_LABELS[cls]}: <span className="font-medium">× {CLASS_FACTORS[cls].toLocaleString("de-DE")}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Was ein Schadenshinweis im Titel bedeutet</h2>
        {/* On a phone the other columns fold into a line under the hint, so nothing scrolls sideways. */}
        <table className="mt-2 w-full text-left text-sm">
          <thead className="hidden text-xs text-muted sm:table-header-group">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">Hinweis</th>
              <th className="py-2 pr-3 font-medium">Gerechnet wird mit</th>
              <th className="py-2 pr-3 font-medium">Sicherheit</th>
              <th className="py-2 font-medium">Abholen</th>
            </tr>
          </thead>
          <tbody>
            {(Object.entries(DAMAGE_JOBS) as [DamageKind, (typeof DAMAGE_JOBS)[DamageKind]][]).map(([kind, rule]) => {
              const jobs = rule.jobs.map((id) => findJob(id)?.label ?? id).join(", ");
              const drivable = rule.drivable ? "fahrbereit" : "Anhänger";
              return (
                <tr key={kind} className="border-b border-line align-top last:border-0">
                  <td className="py-2 pr-3">
                    <span className="font-medium">{DAMAGE_LABELS[kind]}</span>
                    <span className="mt-0.5 block text-muted sm:hidden">
                      {jobs} · <span className="whitespace-nowrap">Sicherheit {CONFIDENCE_LABELS[rule.confidence]}</span> ·{" "}
                      <span className="whitespace-nowrap">{drivable}</span>
                    </span>
                  </td>
                  <td className="hidden py-2 pr-3 sm:table-cell">{jobs}</td>
                  <td className="hidden py-2 pr-3 sm:table-cell">{CONFIDENCE_LABELS[rule.confidence]}</td>
                  <td className="hidden py-2 sm:table-cell">{drivable}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">
          Jedes Auto bekommt dazu „Aufbereitung, Fotos und Verkauf“, eines mit abgelaufener HU die HU-Vorbereitung. Bei Elektroautos
          zählt ein Motor- oder Getriebeschaden als Hochvolt-Fehler.
        </p>
      </section>

      <RiskSection />

      {JOB_GROUPS.map((group) => {
        const jobs = REPAIR_JOBS.filter((job) => job.group === group);
        if (jobs.length === 0) return null;
        return (
          <section key={group} className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-semibold">{group}</h2>
            <table className="mt-2 w-full text-left text-sm">
              <thead className="hidden text-xs text-muted sm:table-header-group">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-medium">Arbeit</th>
                  <th className="py-2 pr-3 font-medium">Stunden</th>
                  <th className="py-2 pr-3 font-medium">Schwierigkeit</th>
                  <th className="py-2 font-medium">Teile (Kompaktklasse)</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-line align-top last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{job.label}</span>
                      <span className="mt-0.5 block sm:hidden">
                        <span className="whitespace-nowrap">{hours(job.hours)}</span> ·{" "}
                        <span className="whitespace-nowrap">Schwierigkeit {job.difficulty}</span> ·{" "}
                        <span className="whitespace-nowrap">Teile {euros(job.partsEur)}</span>
                      </span>
                      {job.tools && <span className="block text-xs text-muted">Braucht: {job.tools}</span>}
                    </td>
                    <td className="hidden whitespace-nowrap py-2 pr-3 sm:table-cell">{hours(job.hours)}</td>
                    <td className="hidden whitespace-nowrap py-2 pr-3 sm:table-cell">{job.difficulty} von 5</td>
                    <td className="hidden whitespace-nowrap py-2 sm:table-cell">{euros(job.partsEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

const pct = (share: number) => `${Math.round(share * 100)} %`;

/** How the risk buffer of a flip comes about, and how far the defect data is. */
function RiskSection() {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 text-sm">
      <h2 className="font-semibold">Risikopuffer</h2>
      <p className="mt-1">
        Was der Anzeigentitel nicht verrät, rechnet der Flip-Rechner als erwartete Kosten mit ein. Er hat zwei Teile:
      </p>
      <h3 className="mt-3 font-medium">Versteckte Mängel aus der Modell-Akte</h3>
      <p className="mt-1">
        Für jedes Modell und Alter ({AGE_BUCKETS.map(([from, to]) => `${from}–${to}`).join(", ")} Jahre) zieht AutoMeta eine Stichprobe
        zugelassener Autos aus dem niederländischen Fahrzeugregister und zählt, bei wie vielen die Hauptuntersuchung (APK) der letzten{" "}
        {WINDOW_MONTHS} Monate einen Mangel gefunden hat, je Baugruppe. Puffer = Anteil der Autos mit Mangel × übliche Teilekosten, für
        jede Baugruppe, die die geplante Reparatur nicht schon abdeckt. Ohne eigene Daten zum Modell zählt der Durchschnitt gleich alter
        Autos, ab {MIN_SAMPLE} Autos in der Stichprobe das Modell selbst.
      </p>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {DEFECT_COMPONENTS.map((component) => (
          <li key={component}>
            {COMPONENT_INFO[component].label}: <span className="text-muted">{findJob(COMPONENT_INFO[component].job)?.label}</span>
          </li>
        ))}
      </ul>
      <Suspense fallback={<p className="mt-2 text-muted">Datenstand wird geladen …</p>}>
        <DefectDataStatusLine />
      </Suspense>
      <h3 className="mt-4 font-medium">Unklarer Schaden</h3>
      <p className="mt-1">
        Bei manchen Hinweisen sagt der Titel nicht, wie schlimm es ist. Liegt der Preis weit unter dem Marktwert, kennt der Verkäufer
        meist einen größeren Schaden. Ab {pct(SEVERE_FROM)} unter Marktwert steigt die angenommene Wahrscheinlichkeit des schlimmeren
        Falls gleichmäßig an, ab {pct(SEVERE_CERTAIN)} gilt er als sicher. Puffer = Wahrscheinlichkeit × Mehrkosten des schlimmeren
        Falls; bei mehreren Hinweisen zählt der teuerste.
      </p>
      <p className="mt-2">
        Der schlimmere Fall kostet mindestens die Teile aus der Liste unten. Bei teuren Autos ist er so teuer wie der Preisnachlass:
        Marktwert minus Preis, minus {formatEuro(LABOR_AND_HASSLE_EUR)} für Werkstattarbeit und Aufwand, minus die schon gerechneten
        Teile. Wer ein Auto, das intakt 34.000 € kostet, für 6.000 € anbietet, kennt meist einen Schaden in dieser Höhe. Das gilt für jeden Hinweis im
        Titel, auch für Motorschaden oder Kupplung.
      </p>
      <ul className="mt-2 space-y-1">
        {(Object.entries(SEVERE_CASES) as [DamageKind, { jobs: string[]; label: string }][]).map(([kind, severe]) => (
          <li key={kind}>
            <span className="font-medium">{DAMAGE_LABELS[kind]}</span>: {severe.label}
            <span className="text-muted"> – gerechnet mit {severe.jobs.map((id) => findJob(id)?.label ?? id).join(", ")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function DefectDataStatusLine() {
  await connection();
  let status;
  try {
    status = await getDefectDataStatus(getPool());
  } catch {
    return null;
  }
  const when = status.lastRunAt
    ? new Date(status.lastRunAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })
    : null;
  return (
    <p className="mt-2 text-xs text-muted">
      Datenstand: {formatNumber(status.profiles)} Modell-Altersgruppen aus {formatNumber(status.cars)} Autos
      {when && <>, letzter Abruf {when}</>}. Quelle: RDW Open Data (CC0).
      {status.lastError && <> Letzter Abruf mit Fehler: {status.lastError}</>}
    </p>
  );
}
